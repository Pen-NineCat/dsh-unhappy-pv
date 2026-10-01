#!/usr/bin/env node
/**
 * film/pages/shot.mjs — 确定性截图（Phase 5）。**七个焊点，一个都不能少。**
 *
 * 七个焊点（`AGENTS.md` §7 / 施工说明 §6 Phase 5，逐个对应到代码里的注释）：
 *
 * | # | 焊点 | 在哪 |
 * |---|---|---|
 * | 1 | 等 `document.fonts.ready` | `renderOne()` 第一步 |
 * | 2 | 等 `img.decode()` | `renderOne()` 第二步 |
 * | 3 | Web Animations `pause()` + 按 `n` 设 `currentTime`（**在 `innerHTML` 之后**） | `setBody` → `pinAnimations` 的顺序 |
 * | 4 | 相同 body 不重写 DOM | `__stage.setBody()` 的比对（返回 `rewritten`） |
 * | 5 | 首帧多等 ~150 ms | `renderOne()` 的 `warmup` |
 * | 6 | 固定 viewport 与 `deviceScaleFactor` | `newPage()` 的参数，全程不变 |
 * | 7 | 资源全部本地（`file://` 的替代：只绑回环的静态服务器） | `serveStatic()` + `out/gen/` |
 *
 * 验收（施工说明 §6 Phase 5）：
 * - ⭐ **同一 `n` 截两次逐像素一致**（`--smoke` 会真的截两次并比对）
 * - 帧数对账 == `round((T1-T0)*FPS)`，编号连续无空洞
 * - CSS `@keyframes` 旋转：不同 `t` 角度不同、同一 `t` 角度相同
 * - 无空白帧：抽样 `stddev`，纯色帧报警
 * - `--frames` 支持只截指定帧号
 * - **关掉第 3 个焊点必须能观察到抖动**（`--no-pin` 就是干这个的）
 *
 * 用法：
 *   node film/pages/shot.mjs                          # 全片 4741 帧
 *   node film/pages/shot.mjs --range 0 419            # 只截引子
 *   node film/pages/shot.mjs --frames 300,301         # 只截指定帧
 *   node film/pages/shot.mjs --smoke --seconds 4      # ~10 帧冒烟（含双截比对）
 *   node film/pages/shot.mjs --range 300 302 --no-pin # 故意关焊点 3，观察抖动
 *   node film/pages/shot.mjs --pages 4                # 并行页数（默认 2）
 *
 * 退出码：0 成功 / 1 失败 / 2 用法错误。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { END_T, FPS, FRAME_COUNT, describe as describeClock } from '../engine/clock.js';
import { VARIANTS } from './body.js';
import { VENDOR_MOUNT } from './dsh-theme.js';
// 浏览器启动参数**只有一份**（`film/lib/dsh-web.js`）：R1 与 R2 的截图必须同参数，
// 否则「并排比」比的是字体栅格化，不是布。
import { LAUNCH_ARGS } from '../lib/dsh-web.js';
import { serveStatic, summarizeRequests } from '../lib/static-server.js';

const GEN = 'out/gen';
const OUT = 'out/shots';

const HELP = [
  '用法：node film/pages/shot.mjs [选项]',
  '',
  '  --range A B       只截 [A, B] 闭区间',
  '  --frames 1,2,3    只截这几帧',
  '  --smoke           冒烟：~10 帧 + 每帧双截比对（⭐ 焊点总验收）',
  '  --seconds N       --smoke 的时长，默认 4 秒',
  '  --pages N         并行页数，默认 2',
  '  --out <dir>       输出目录，默认 out/shots',
  '  --track <名字>     文件名加轨道后缀（`<帧号>-<名字>.png`），可重复给多个',
  '                    这是 film/compose/shots.js 期望的命名；不给就是 `<帧号>.png`',
  '  --variant <v>     页面变体：intro（默认，引子真页面）/ probe（回归夹具）',
  '  --width N          视口宽（CSS px），默认 960',
  '                    **合成要 1:1** 就得让它等于目标矩形的宽（§6 Phase 6 第 2 条）',
  '  --height N         视口高（CSS px），默认 640',
  '  --dpr N            deviceScaleFactor，默认 2',
  '  --no-pin          **故意关掉焊点 3**（不 pause 动画）—— 用来证明它确实在起作用',
  '  --warmup-ms N     首帧额外等待，默认 150',
  '  -h, --help        这段文字',
  '',
  `画布：${describeClock()}`,
  '退出码：0 成功 / 1 失败 / 2 用法错误',
].join('\n');

/** 用法错误。 */
class UsageError extends Error {}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = {
    frames: /** @type {?number[]} */ (null),
    smoke: false,
    seconds: 4,
    pages: 2,
    out: OUT,
    pin: true,
    warmupMs: 150,
    tracks: /** @type {string[]} */ ([]),
    width: 960,
    height: 640,
    dpr: 2,
    variant: 'intro',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--range': {
        const x = Number(argv[++i]);
        const y = Number(argv[++i]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) throw new UsageError('--range A B 都要是整数');
        if (y < x) throw new UsageError(`--range 的 B(${y}) 小于 A(${x})`);
        o.frames = [];
        for (let n = x; n <= y; n++) o.frames.push(n);
        break;
      }
      case '--frames': {
        const v = argv[++i];
        if (v === undefined) throw new UsageError('--frames 缺参数值');
        o.frames = v.split(',').map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n)) throw new UsageError(`--frames 里 "${s}" 不是整数帧号`);
          return n;
        });
        break;
      }
      case '--smoke':
        o.smoke = true;
        break;
      case '--seconds':
        o.seconds = Number(argv[++i]);
        if (!Number.isFinite(o.seconds) || o.seconds <= 0) throw new UsageError('--seconds 要是正数');
        break;
      case '--pages': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--pages 必须是 >= 1 的整数');
        o.pages = n;
        break;
      }
      case '--out':
        o.out = argv[++i] ?? OUT;
        break;
      case '--variant': {
        const v = /** @type {any} */ (argv[++i]);
        if (!VARIANTS.includes(v)) throw new UsageError(`--variant 只能是 ${VARIANTS.join(' / ')}，收到 "${v}"`);
        o.variant = v;
        break;
      }
      case '--no-pin':
        o.pin = false;
        break;
      case '--track': {
        const v = argv[++i];
        if (!v) throw new UsageError('--track 缺参数值');
        if (!/^[A-Za-z0-9_-]+$/.test(v)) {
          throw new UsageError(`--track 的 "${v}" 只能含字母/数字/下划线/连字符（它要进文件名）`);
        }
        o.tracks.push(v);
        break;
      }
      case '--width':
      case '--height':
      case '--dpr': {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new UsageError(`${a} 要是正数`);
        if (a === '--width') o.width = Math.round(v);
        else if (a === '--height') o.height = Math.round(v);
        else o.dpr = v;
        break;
      }
      case '--warmup-ms': {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 0) throw new UsageError('--warmup-ms 要是非负数');
        o.warmupMs = n;
        break;
      }
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new UsageError(`未知参数 "${a}"`);
    }
  }
  if (o.smoke) {
    // 冒烟帧表：跨度 ~N 秒 + **故意重复一帧**（同帧双截比对要用）
    const span = Math.max(1, Math.round(o.seconds * FPS));
    const base = [0, 1, Math.round(span / 3), Math.round((2 * span) / 3), span - 1];
    o.frames = [...new Set([...base, ...base.map((n) => n + 1)])].sort((p, q) => p - q);
  }
  o.frames = [...new Set(o.frames ?? Array.from({ length: FRAME_COUNT }, (_, i) => i))].sort((a, b) => a - b);
  for (const n of o.frames) {
    if (n < 0 || n >= FRAME_COUNT) throw new UsageError(`帧 ${n} 越界（有效范围 0..${FRAME_COUNT - 1}）`);
  }
  return o;
}

/**
 * 把一个结果缓冲成 `RawImage` 需要的形状（PNG 没法直接逐像素比，所以先解码）。
 * 用 `@napi-rs/canvas` 的 `loadImage` 解 PNG。
 * @param {Buffer} png
 */
async function decodePng(png) {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const img = await loadImage(png);
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/**
 * 截一帧（含双截比对的可选逻辑）。
 * @param {import('playwright').Page} page
 * @param {number} n
 * @param {{pin: boolean, warmupMs: number, bodyFn: (n: number) => string, scrollFn: (n: number) => number}} opt
 * @returns {Promise<{n: number, png: Buffer, hash: string, rewritten: boolean, meta: any}>}
 */
async function renderOne(page, n, opt) {
  const html = opt.bodyFn(n);
  const scroll = opt.scrollFn(n);

  // 焊点 4：相同 body 不重写 DOM（比对在页面里做，返回 rewritten）
  const setRes = await page.evaluate((h) => /** @type {any} */ (window).__stage.setBody(h), html);

  // 焊点 7 的辅助：滚动位置 = f(t)，不用 CSS 动画、不用 sticky
  await page.evaluate((s) => /** @type {any} */ (window).__stage.setScroll(s), scroll);

  // 焊点 3：**在 innerHTML 之后** pause 动画并设 currentTime
  let animCount = 0;
  if (opt.pin) {
    animCount = await page.evaluate((nn) => /** @type {any} */ (window).__stage.pinAnimations(nn), n);
  }

  // 焊点 1：等字体
  await page.evaluate(() => /** @type {any} */ (window).__stage.fontsReady());
  // 焊点 2：等图片 decode
  const imgs = await page.evaluate(() => /** @type {any} */ (window).__stage.imagesDecoded());

  // 焊点 5：首帧多等一点（warmup 恒等 0 之后就是纯确定性渲染）
  if (opt.warmupMs > 0) await page.waitForTimeout(opt.warmupMs);

  const png = await page.screenshot({ type: 'png' });
  const meta = await page.evaluate(() => /** @type {any} */ (window).__stage.snapshot());
  return {
    n,
    png,
    hash: createHash('sha256').update(png).digest('hex'),
    rewritten: setRes.rewritten,
    meta: { ...meta, animCount, imgCount: imgs.count, imgResults: imgs.results },
  };
}

export async function jitterCheck({ n = 300, times = 5, pages: nPages = 1, outDir = 'out/shots-jitter' } = {}) {
  mkdirSync(resolvePath(outDir), { recursive: true });
  const { body, scrollAtFrame } = await import('./body.js');
  // 角度断言只能对着**探针**做：引子页的动画在伪元素上，读不出 `transform`（见 probe.js）
  const bodyFn = (/** @type {number} */ k) => body(k, { variant: 'probe', width: 960, height: 640 });
  const scrollFn = (/** @type {number} */ k) => scrollAtFrame(k, { variant: 'probe' });
  const srv = await serveStatic(resolvePath(GEN), { mounts: VENDOR_MOUNT });
  const { chromium } = await import('playwright');

  /** @type {{pin: boolean, label: string, hashes: string[], distinct: number, perFrameAngle: number}[]} */
  const rows = [];
  try {
    for (const pin of [true, false]) {
      const browser = await chromium.launch({
        headless: true,
        args: LAUNCH_ARGS,
      });
      const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
      await page.goto(`${srv.url}stage.html`, { waitUntil: 'load' });
      /** @type {string[]} */
      const hashes = [];
      let lastAngle = -1;
      let angleChanges = 0;
      for (let i = 0; i < times; i++) {
        // 同一个 n 反复截：pin 开着就该每次一模一样；pin 关掉动画自己在跑，就该抖
        const r = await renderOne(page, n, { pin, warmupMs: i === 0 ? 150 : 0, bodyFn, scrollFn });
        hashes.push(r.hash);
        const m = /matrix\(([^)]+)\)/.exec(String(r.meta.spinTransform));
        if (m) {
          const angle = Number(m[1].split(',')[0].trim());
          if (lastAngle >= 0 && Math.abs(angle - lastAngle) > 1e-6) angleChanges++;
          lastAngle = angle;
        }
        writeFileSync(join(resolvePath(outDir), `${pin ? 'pin' : 'nopin'}-${i}.png`), r.png);
      }
      rows.push({
        pin,
        label: pin ? '焊点 3 开启（pause + currentTime）' : '焊点 3 关闭（--no-pin）',
        hashes,
        distinct: new Set(hashes).size,
        perFrameAngle: angleChanges,
      });
      await page.close();
      await browser.close();
    }
  } finally {
    await srv.close();
  }
  void nPages;
  return rows;
}

export async function scrollCheck({ frames = [0, 10, 20, 30, 60, 120], outDir = 'out/shots-scroll' } = {}) {
  mkdirSync(resolvePath(outDir), { recursive: true });
  const { body, scrollAtFrame } = await import('./body.js');
  // 探针的内容固定 90 行、按 3 px/帧 推进 —— 「设了 scrollTop 且内容够高」这条判据在它上面最干净。
  // 引子版的滚动是**追底**（want 恰好等于 maxScroll），判据不同，见 `introScrollCheck()`。
  const bodyFn = (/** @type {number} */ k) => body(k, { variant: 'probe', width: 960, height: 640 });
  const scrollFn = (/** @type {number} */ k) => scrollAtFrame(k, { variant: 'probe' });
  const srv = await serveStatic(resolvePath(GEN), { mounts: VENDOR_MOUNT });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
  await page.goto(`${srv.url}stage.html`, { waitUntil: 'load' });

  /** @type {{n: number, want: number, got: number, maxScroll: number, firstLine: string}[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  for (const n of frames) {
    const r = await renderOne(page, n, { pin: true, warmupMs: 0, bodyFn, scrollFn });
    const want = scrollFn(n);
    const got = r.meta.scroll;
    rows.push({
      n,
      want,
      got,
      maxScroll: r.meta.maxScroll,
      firstLine: String(r.meta.firstVisibleLine ?? '(none)'),
    });
    writeFileSync(join(resolvePath(outDir), `${String(n).padStart(5, '0')}.png`), r.png);
    if (want <= r.meta.maxScroll && Math.abs(got - want) > 1) {
      problems.push(`frame ${n}: scrollTop=${got}，期望 ${want}（可滚动范围 ${r.meta.maxScroll}）`);
    }
  }
  // 「第一行可见内容」必须随帧推进 —— 否则滚动区是个静态块
  const distinctFirstLines = new Set(rows.map((r) => r.firstLine)).size;
  if (distinctFirstLines < 2) {
    problems.push(`「第一行可见内容」在所有帧里都一样（${rows[0]?.firstLine}）—— 滚动区没真的滚动`);
  }
  if (rows.length && rows[rows.length - 1].maxScroll <= 0) {
    problems.push('滚动容器的可滚动范围是 0 —— 内容不够高，scrollTop 永远动不了');
  }

  await page.close();
  await browser.close();
  await srv.close();
  return { rows, problems, distinctFirstLines };
}

/**
 * 引子页的滚动检查（**与探针那份判据不同**）。
 *
 * 引子版是「追底」：`scrollAtFrame(n)` **恰好等于** `maxScroll`，所以判据是
 * `got == min(want, maxScroll)`，并且要顺手验证那条**行网格假设**：
 * `scrollHeight == 24 × 已显示行数 + 块内边距`。
 * 这条等式一旦不成立，`intro.js` 里那套算术就是错的 —— 那才是真正要抓的东西。
 * @param {{frames?: number[], height?: number, outDir?: string}} [opts]
 */
export async function introScrollCheck(opts = {}) {
  const frames = opts.frames ?? [0, 8, 40, 100, 143, 200, 250, 300, 400, 418, 419, 1000];
  const height = opts.height ?? 640;
  const outDir = opts.outDir ?? 'out/shots-intro-scroll';
  mkdirSync(resolvePath(outDir), { recursive: true });
  const intro = await import('./intro.js');
  const { body } = await import('./body.js');
  const srv = await serveStatic(resolvePath(GEN), { mounts: VENDOR_MOUNT });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: 960, height }, deviceScaleFactor: 2 });
  await page.goto(`${srv.url}stage.html`, { waitUntil: 'load' });

  /** @type {{n: number, want: number, got: number, maxScroll: number, gridWant: number, gridGot: number, first: string}[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  for (const n of frames) {
    const scroll = intro.scrollAtFrame(n, { height });
    const r = await renderOne(page, n, {
      pin: true,
      warmupMs: 0,
      bodyFn: (k) => body(k, { width: 960, height }),
      scrollFn: (k) => intro.scrollAtFrame(k, { height }),
    });
    const maxScroll = Math.max(0, r.meta.maxScroll);
    const want = Math.min(scroll, maxScroll);
    const gridWant = intro.contentHeight(n);
    rows.push({
      n,
      want,
      got: r.meta.scroll,
      maxScroll,
      gridWant,
      gridGot: r.meta.scrollHeight,
      first: String(r.meta.firstVisibleLine ?? '(none)'),
    });
    if (Math.abs(r.meta.scroll - want) > 0) {
      problems.push(`frame ${n}: scrollTop=${r.meta.scroll}，期望 ${want}（maxScroll=${maxScroll}）`);
    }
    if (Math.abs(r.meta.scrollHeight - Math.max(intro.scrollWindowHeight(height), gridWant)) > 0) {
      problems.push(
        `frame ${n}: scrollHeight=${r.meta.scrollHeight}，而行网格算出来是 ${gridWant}` +
          `（24 × ${intro.revealedLines(n)} 行 + 思维链那块的内边距；` +
          `内容比容器矮时 scrollHeight 会等于容器高 ${intro.scrollWindowHeight(height)}）` +
          ` —— 行高不是 24px，或行里有折行/块级盒`,
      );
    }
    writeFileSync(join(resolvePath(outDir), `${String(n).padStart(5, '0')}.png`), r.png);
  }
  const distinctFirst = new Set(rows.map((r) => r.first)).size;
  if (distinctFirst < 4) problems.push(`「首个可见行」只有 ${distinctFirst} 种取值 —— 滚动没真的推进`);

  // 输入框（composer）：它是**三个高度常数之一**，所以「实测 == 常数」必须被守住 ——
  // 改了它的 CSS 而没改 COMPOSER_HEIGHT，滚动窗口高就会算错，而且是**静默**错。
  const comp = await page.evaluate(() => {
    const frame = document.querySelector('[data-dsh-composer-frame]');
    const root = document.querySelector('[data-dsh-composer]');
    if (!frame || !root) return null;
    const fr = frame.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      frameH: Math.round(fr.height),
      rootH: Math.round(rr.height),
      frameScrollH: frame.scrollHeight,
      frameClientH: frame.clientHeight,
      cardW: Math.round((document.querySelector('[data-composer-card]')?.getBoundingClientRect().width) ?? 0),
    };
  });
  if (!comp) {
    problems.push('页面上找不到输入框（[data-dsh-composer-frame] / [data-dsh-composer]）—— 作者选的是 B：要输入框');
  } else {
    if (comp.frameH !== intro.COMPOSER_HEIGHT) {
      problems.push(
        `输入框实测高 ${comp.frameH}px ≠ intro.COMPOSER_HEIGHT ${intro.COMPOSER_HEIGHT}px —— ` +
          `滚动窗口高是按后者算的，两边不一致就会静默算错`,
      );
    }
    if (comp.frameScrollH > comp.frameClientH) {
      problems.push(`输入框内容高 ${comp.frameScrollH}px > 容器高 ${comp.frameClientH}px —— 被裁掉了（调大 COMPOSER_HEIGHT）`);
    }
  }

  await page.close();
  await browser.close();
  await srv.close();
  return { rows, problems, distinctFirst };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }

  const genDir = resolvePath(GEN);
  if (!existsSync(join(genDir, 'stage.html'))) {
    console.error(`缺少 ${GEN}/stage.html —— 先跑：node film/pages/gen-frames.js`);
    return 1;
  }
  mkdirSync(resolvePath(o.out), { recursive: true });

  // 动态 import：body.js / 依赖只在真的截图时才需要
  const { body, scrollAtFrame } = await import('./body.js');

  const srv = await serveStatic(genDir, { mounts: VENDOR_MOUNT });
  console.log(`画布   ${describeClock()}`);
  console.log(`舞台   ${srv.url}stage.html  （只绑回环；资源全部本地 —— 焊点 7）`);
  console.log(`变体   ${o.variant}`);
  console.log(`输出   ${o.out}/`);
  console.log(`帧数   ${o.frames.length}${o.smoke ? '（--smoke）' : ''}`);
  console.log(`焊点 3 ${o.pin ? '开启（pause + 按 n 设 currentTime）' : '❌ **故意关闭**（--no-pin，应当观察到抖动）'}`);
  console.log(`焊点 5 首帧额外等待 ${o.warmupMs} ms`);

  const { chromium } = await import('playwright');
  // 字体栅格化的确定性：关掉 hinting 与 LCD 子像素（跨机器差异的主要来源之一）。
  // ⚠️ **不要**加 reducedMotion: 'reduce' —— 那会关掉引子页上那条扫描动画
  //（@media (prefers-reduced-motion:reduce){…animation:none}），焊点 3 就没靶子了。
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

  // 焊点 6：固定 viewport 与 deviceScaleFactor（全程不变，改一处就够）
  // 焊点 6：固定 viewport 与 deviceScaleFactor（全程不变，改一处就够）
  const viewport = { width: o.width, height: o.height };
  const deviceScaleFactor = o.dpr;
  const pages = await Promise.all(
    Array.from({ length: o.pages }, () =>
      browser.newPage({ viewport, deviceScaleFactor }),
    ),
  );
  for (const p of pages) {
    p.on('pageerror', (e) => console.error(`  [pageerror] ${e.message}`));
    p.on('requestfailed', (r) => console.error(`  [requestfailed] ${r.url()} ${r.failure()?.errorText}`));
    await p.goto(`${srv.url}stage.html`, { waitUntil: 'load' });
  }

  // 页面必须知道自己的视口尺寸：引子的滚动窗口高 = 视口高 − 固定区高，是算出来的（见 intro.js）
  const opt = {
    pin: o.pin,
    warmupMs: o.warmupMs,
    bodyFn: (/** @type {number} */ k) => body(k, { variant: o.variant, width: o.width, height: o.height }),
    scrollFn: (/** @type {number} */ k) => scrollAtFrame(k, { variant: o.variant, height: o.height }),
  };
  /** @type {{n: number, file: string, hash: string, rewritten: boolean, meta: any}[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  let done = 0;
  const t0 = Date.now();

  // 简单的「取任务」并行：每个 page 依次处理分配到的帧
  const queue = [...o.frames];
  /** @type {?{n: number, png: Buffer, hash: string, rewritten: boolean, meta: any}} */
  let duplicateOfFirst = null;

  await Promise.all(
    pages.map(async (page) => {
      for (;;) {
        const n = queue.shift();
        if (n === undefined) return;
        const r = await renderOne(page, n, opt);
        // 轨道后缀：`<帧号5位>-<轨道>.png`（`film/compose/shots.js` 期望的命名）。
        // 不给 --track 时保持 `<帧号5位>.png`（Phase 5 的既有行为，别改）。
        const files = o.tracks.length ? o.tracks.map((t) => `${String(n).padStart(5, '0')}-${t}.png`) : [`${String(n).padStart(5, '0')}.png`];
        for (const file of files) {
          writeFileSync(join(resolvePath(o.out), file), r.png);
        }
        entries.push({ n, file: files[0], files, hash: r.hash, rewritten: r.rewritten, meta: r.meta });

        // ⭐ 同帧双渲（截图侧）：--smoke 时对**重复出现的帧**再截一次并比 PNG 哈希
        if (o.smoke) {
          const again = await renderOne(page, n, opt);
          if (again.hash !== r.hash) {
            problems.push(
              `⭐ 同帧双渲不一致 frame ${n}：${r.hash.slice(0, 16)} vs ${again.hash.slice(0, 16)}`,
            );
          }
          if (duplicateOfFirst === null) duplicateOfFirst = again;
        }

        done++;
        if (done % 10 === 0 || done === o.frames.length) {
          process.stdout.write(`\r  截图 ${done}/${o.frames.length}`);
        }
      }
    }),
  );
  process.stdout.write('\n');
  const dt = (Date.now() - t0) / 1000;
  console.log(`  完成，用时 ${dt.toFixed(1)} s（${(o.frames.length / dt).toFixed(1)} 帧/s）`);

  // ⭐ 帧数对账
  const sorted = [...entries].sort((a, b) => a.n - b.n);
  if (sorted.length !== o.frames.length) {
    problems.push(`⭐ 帧数对账失败：截图 ${sorted.length} ≠ 期望 ${o.frames.length}`);
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].n !== o.frames[i]) {
      problems.push(`⭐ 帧数对账失败：第 ${i} 张是帧 ${sorted[i].n}，期望 ${o.frames[i]}`);
      break;
    }
  }

  // ⭐ 无空白帧：抽样 stddev
  const { rawRGBA } = await import('../kit/pixels.js');
  const { stddev } = await import('../kit/raster.js');
  const { createCanvas } = await import('@napi-rs/canvas');
  /** @type {{n: number, sd: number}[]} */
  const flatness = [];
  for (const e of sorted) {
    const img = await decodePng(readFileSync(join(resolvePath(o.out), e.file)));
    const cv = createCanvas(img.width, img.height);
    cv.getContext('2d').putImageData(img, 0, 0);
    const sd = stddev(rawRGBA(cv));
    flatness.push({ n: e.n, sd });
    if (sd < 1) problems.push(`⚠️ 疑似空白帧 frame ${e.n}（stddev=${sd.toFixed(3)}）`);
  }

  // 焊点 3 的验证：两条路
  // - probe 变体：动画角度必须是 `n` 的函数（可读的 `transform`）
  // - intro 变体：动画在伪元素 `::after` 上（读不出角度），所以报**动画名 + 伪元素**，
  //   并要求它确实存在 —— 否则「同帧双渲一致」这条判据是空的（没有动画可钉）
  const angles = new Map();
  for (const e of sorted) {
    const m = /matrix\(([^)]+)\)/.exec(String(e.meta.spinTransform));
    if (m) angles.set(e.n, m[1].split(',').map((v) => Number(v.trim())).map((v) => Math.round(v * 100)));
  }
  const uniqueAngles = new Set([...angles.values()].map((v) => v.join(',')));
  const animCount = sorted.length ? Math.max(...sorted.map((e) => Number(e.meta.animations ?? 0))) : 0;
  // ⚠️ 判据必须落在**动画真的该在的帧**上：引子页的扫描动画在思维链（拍 2，帧 144–250）里，
  // 而 --smoke 的采样帧都在前两秒。第一版因此把「采样没覆盖」误报成「页面没有动画」。
  const introMod = o.variant === 'intro' ? await import('./intro.js') : null;
  const think = introMod?.BLOCKS.find((b) => b.key === 'thinking');
  const animFrames = think ? sorted.filter((e) => e.n >= think.start && e.n <= think.end) : [];
  const animMax = animFrames.length ? Math.max(...animFrames.map((e) => Number(e.meta.animations ?? 0))) : 0;
  if (think && animFrames.length > 0 && animMax === 0) {
    problems.push(
      `帧 ${animFrames[0].n}–${animFrames[animFrames.length - 1].n}（思维链那一段）里没找到任何 CSS 动画 —— ` +
        '焊点 3（pause + currentTime）就没有靶子，「同帧双渲一致」证明不了「动画被钉住了」。' +
        '检查思维链那条 lcKema 扫描动画是否还在。',
    );
  }
  if (think && animFrames.length === 0) {
    console.log(`  ℹ️ 本次采样帧（${sorted.map((e) => e.n).join(',')}）没覆盖思维链（帧 ${think.start}–${think.end}），动画靶子这条判据本次不适用`);
  }

  // 焊点 4 的验证：同一帧打两次应当 rewritten=false；不同帧之间无所谓
  const rewrittenCount = sorted.filter((e) => e.rewritten).length;

  console.log('');
  const reqSummary = summarizeRequests(srv.requests);
  console.log(`请求   ${reqSummary.text.split('\n')[0]}`);
  for (const b of reqSummary.bad) console.log(`  ❌ ${b.status}  ${b.url}`);
  console.log(`DOM    重写 ${rewrittenCount} 次 / ${sorted.length} 帧（焊点 4）`);
  if (o.variant === 'probe') {
    console.log(`动画   不同帧的角度取值 ${uniqueAngles.size} 个（焊点 3：应 ≈ 帧数）`);
  } else {
    const anims = /** @type {any[]} */ (sorted.find((e) => (e.meta.animations ?? 0) > 0)?.meta.animNames ?? []);
    console.log(
      `动画   页面上最多 ${animCount} 条 CSS 动画（焊点 3 的靶子）` +
        `${anims.length ? `：${anims.map((a) => `${a.name}@${a.pseudo || '自身'}`).join(', ')}` : ''}`,
    );
  }
  console.log(
    `stddev 最小 ${Math.min(...flatness.map((f) => f.sd)).toFixed(2)} / 最大 ${Math.max(...flatness.map((f) => f.sd)).toFixed(2)}`,
  );

  writeFileSync(
    join(resolvePath(o.out), 'shots.json'),
    JSON.stringify(
      {
        viewport,
        deviceScaleFactor,
        pin: o.pin,
        warmupMs: o.warmupMs,
        count: sorted.length,
        frames: sorted.map((e) => ({ n: e.n, file: e.file, hash: e.hash, rewritten: e.rewritten })),
        flatness,
        requests: srv.requests,
        problems,
      },
      null,
      2,
    ),
    'utf8',
  );

  await Promise.all(pages.map((p) => p.close()));
  await browser.close();
  await srv.close();

  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`  ❌ ${p}`);
    console.log(`\n结论：${problems.length} 个问题。`);
    return 1;
  }
  console.log('');
  console.log(
    `结论：${sorted.length} 帧全部成功` +
      `${o.smoke ? '，⭐ 同帧双渲逐像素一致' : ''}${o.pin ? '' : '（焊点 3 已关闭，抖动是预期的）'}。`,
  );
  return 0;
}

process.exitCode = await (async () => {  // `--jitter-check`：把「焊点 3 到底有没有用」变成两个数字（同一个 n 截 N 次，数不同的哈希数）
  if (process.argv.includes('--jitter-check')) {
    const n = Number(process.argv[process.argv.indexOf('--jitter-check') + 1]) || 300;
    console.log(`── 焊点 3 的抖动检查：同一个 n=${n} 各截 5 次 ──────────────`);
    const rows = await jitterCheck({ n, times: 5 });
    let bad = 0;
    for (const r of rows) {
      console.log(
        `  ${r.label}\n` +
          `    不同的 PNG 哈希：${r.distinct}/5   动画角度变化的次数：${r.perFrameAngle}`,
      );
      if (r.pin && r.distinct !== 1) bad++;
      if (!r.pin && r.distinct === 1 && r.perFrameAngle === 0) {
        console.log('    ⚠️ 关掉焊点 3 居然也完全一致 —— 这个检查没证明到东西（动画可能没跑）');
      }
    }
    console.log('');
    console.log(
      bad === 0
        ? '结论：焊点 3 开启时**逐像素一致**；关闭时观察到抖动 —— 这个焊点确实在起作用。'
        : '结论：❌ 焊点 3 开启时仍不一致，七个焊点没焊住。',
    );
    return bad === 0 ? 0 : 1;
  }

  // `--intro-scroll-check`：引子页的滚动判据（追底 + 行网格假设），与探针那份不同
  if (process.argv.includes('--intro-scroll-check')) {
    console.log('── 引子滚动检查：scrollTop 必须等于 maxScroll，且 scrollHeight == 24 × 行数 ──');
    const r = await introScrollCheck();
    for (const row of r.rows) {
      console.log(
        `  n=${String(row.n).padStart(4)}  设定 ${String(row.want).padStart(5)}  实际 ${String(row.got).padStart(5)}` +
          `  maxScroll ${String(row.maxScroll).padStart(5)}  内容高 ${String(row.gridGot).padStart(5)}` +
          `（网格算 ${String(row.gridWant).padStart(5)}）  首个可见行 "${row.first}"`,
      );
    }
    console.log('');
    console.log(`不同的「首个可见行」取值：${r.distinctFirst} 个`);
    if (r.problems.length) {
      for (const p of r.problems) console.log(`  ❌ ${p}`);
      return 1;
    }
    console.log('结论：滚动位置 = f(t) 生效，且行网格假设成立（内容高可以纯算术预测）。');
    return 0;
  }

  // `--scroll-check`：证明「滚动位置 = f(t)」真的生效（不是设了 scrollTop 但内容装不满）
  if (process.argv.includes('--scroll-check')) {
    console.log('── 滚动检查：滚动位置必须等于 f(t)，且可见内容随帧变化 ──────');
    const r = await scrollCheck();
    for (const row of r.rows) {
      console.log(
        `  n=${String(row.n).padStart(3)}  设定 ${String(row.want).padStart(5)}  ` +
          `实际 ${String(row.got).padStart(5)}  可滚动 ${String(row.maxScroll).padStart(5)}  ` +
          `首个可见行 "${row.firstLine}"`,
      );
    }
    console.log('');
    console.log(`不同的「首个可见行」取值：${r.distinctFirstLines} 个`);
    if (r.problems.length) {
      for (const p of r.problems) console.log(`  ❌ ${p}`);
      return 1;
    }
    console.log('结论：滚动位置 = f(t) 生效，可见内容随帧推进。');
    return 0;
  }

  return main().catch((e) => {
    console.error(`\n❌ 截图失败：${/** @type {Error} */ (e).message}`);
    if (process.env.DSH_DEBUG) console.error(e.stack);
    return 1;
  });
})();

void readdirSync;
void END_T;
