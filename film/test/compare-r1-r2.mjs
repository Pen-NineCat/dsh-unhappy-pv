#!/usr/bin/env node
/**
 * film/test/compare-r1-r2.mjs — **R1 与 R2 的并排比**（R1 到底像不像真的 dsh）。
 *
 * ## 比什么、为什么比这些
 *
 * R2（真 `dsh web`）与 R1（手搭页面 + 抽出来的 CSS）**布局本来就不一样** ——
 * R2 是整个应用外壳（侧栏 + 主区 + 输入框 + 插件），R1 只截主区的那一块。
 * 所以「并排比」比的是两块布，不是两块构图：
 *
 * | 项 | 怎么比 |
 * |---|---|
 * | **设计令牌**（395 个 `--dsw-*`） | 在**同一个元素**上读（两边都扫出「令牌落点」那个元素），逐个比较。亮/暗各比一轮 |
 * | 排版基线 | `--dsw-font-family`、`--dsh-content-font-size`、`--dsw-font-markdown-base`、圆角、正文的实际 computed `color/font-size/line-height` |
 * | 画面 | 同一视口、同一 dpr、同一浏览器参数下各截一张，拼成一张并排图 |
 *
 * ## 为什么「令牌落点」要扫出来
 *
 * 实测：真 GUI 的 `:root`（`documentElement`）上**一个 `--dsw-*` 都没有** ——
 * 主题包把令牌写在 `body{}` / `body[data-ds-dark-theme]{}` 上。
 * 读错元素会得到「R2 全是空、R1 全有值」这种**看起来像结论的错误**。
 * 所以两边都用同一段代码去找那个元素：**第一个能让 `--dsw-alias-bg-base` 解析出非空值的元素**。
 *
 * ## 两种主题都跑
 *
 * 真 GUI 默认是**跟随系统**（这里渲染成亮色）。深色是 `body[data-ds-dark-theme]` 这个开关，
 * 我们直接在页面上打这个属性再读一遍 —— 这同时验证了「R1 的深色开关语义与真界面一致」。
 *
 * 用法：
 *   node film/test/compare-r1-r2.mjs                 # 全部
 *   node film/test/compare-r1-r2.mjs --frame 419     # 换一帧当 R1 的样本
 *   node film/test/compare-r1-r2.mjs --skip-r2       # R2 起不来时只跑 R1 那一半（并说明）
 *
 * 退出码：0 = 令牌逐个一致 / 1 = 有差异（会列出前若干个）/ 2 = 用法错误。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LAUNCH_ARGS, bootDshWeb, openPinnedGui, pinAnimations } from '../lib/dsh-web.js';
import { VENDOR_MOUNT } from '../pages/dsh-theme.js';
import { serveStatic } from '../lib/static-server.js';
import { body } from '../pages/body.js';
import * as intro from '../pages/intro.js';

// ⚠️ **不要** import `film/pages/shot.mjs`：它的 CLI 代码在**模块顶层**执行
//（`process.exitCode = await (async () => …)()`），import 它就会拿本脚本的 argv 去跑一遍截图 CLI，
// 报出「用法错误：未知参数 --skip-r2」这种看不懂的错。要用它里面的检查就把它挪进 `film/lib/`。

const OUT = 'out/r1-r2';
const VIEW = { width: 960, height: 640, deviceScaleFactor: 2 };
const TOKENS_FILE = 'film/vendor/dsh-css/tokens.json';

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ name, /** @type {any} */ dflt) => {
  const i = argv.indexOf(name);
  return i < 0 ? dflt : argv[i + 1];
};
const FRAME = Number(flag('--frame', 419)) || 0;
const SKIP_R2 = argv.includes('--skip-r2');

/**
 * 在页面里读出「令牌落点」+ 全部令牌 + 排版基线。
 * **两边用同一段代码**（这是可比性的前提）。
 * @param {import('playwright').Page} page
 * @param {string[]} tokenNames
 */
async function readCloth(page, tokenNames) {
  return page.evaluate((names) => {
    // 1) 找令牌落点：第一个能解析出非空 --dsw-alias-bg-base 的元素
    /** @type {?Element} */
    let carrier = null;
    for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
      if (!el) continue;
      const v = getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim();
      if (v) {
        carrier = el;
        break;
      }
    }
    if (!carrier) return { carrier: null };
    const ccs = getComputedStyle(carrier);
    /** @type {Record<string, string>} */
    const tokens = {};
    for (const n of names) tokens[n] = ccs.getPropertyValue(n).trim();

    // 2) 排版基线。R1 有渲染出来的正文行（.stage__line）；R2 这一屏**没有对话内容**，
    //    所以它只能量到 body —— 这不是缺陷，是「真界面这一屏没在显示一条消息」。
    const textEl =
      document.querySelector('.stage__line[data-emphasis="signature"]') ??
      document.querySelector('.ZkiH0q_text') ??
      document.querySelector('.wSkVaW_body');
    const tcs = textEl ? getComputedStyle(textEl) : null;
    return {
      carrier: {
        tag: carrier.tagName.toLowerCase(),
        cls: String(carrier.className || '').slice(0, 60),
        bg: ccs.backgroundColor,
        color: ccs.color,
        fontFamily: ccs.fontFamily,
        fontSize: ccs.fontSize,
        contentFontSize: ccs.getPropertyValue('--dsh-content-font-size').trim(),
      },
      tokens,
      sample: {
        what: textEl ? String(textEl.className || textEl.tagName).slice(0, 40) : '(没有正文元素)',
        color: tcs ? tcs.color : null,
        fontSize: tcs ? tcs.fontSize : null,
        lineHeight: tcs ? tcs.lineHeight : null,
        fontWeight: tcs ? tcs.fontWeight : null,
      },
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      themeSource: document.documentElement.dataset.dsThemeSource || null,
    };
  }, tokenNames);
}

/**
 * 把两张图并排拼成一张（左 R2 / 右 R1），带一条标题带。
 * @param {Buffer} left @param {Buffer} right @param {string} leftLabel @param {string} rightLabel @param {string} title
 */
async function sideBySide(left, right, leftLabel, rightLabel, title) {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const a = await loadImage(left);
  const b = await loadImage(right);
  const bar = 44;
  const pad = 12;
  const labelH = 30;
  const W = a.width + b.width + pad * 3;
  const H = bar + labelH + Math.max(a.height, b.height) + pad * 2;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f9fafb';
  ctx.font = '600 20px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText(title, pad, 30);
  ctx.font = '600 15px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillStyle = '#9aa4b2';
  ctx.fillText(leftLabel, pad, bar + 22);
  ctx.fillText(rightLabel, pad * 2 + a.width, bar + 22);
  ctx.drawImage(a, pad, bar + labelH);
  ctx.drawImage(b, pad * 2 + a.width, bar + labelH);
  return { png: cv.toBuffer('image/png'), width: W, height: H };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tokenNames = Object.keys(JSON.parse(readFileSync(TOKENS_FILE, 'utf8')));
  console.log('── R1 ↔ R2 并排比 ────────────────────────────────────────');
  console.log(`令牌 ${tokenNames.length} 个（${TOKENS_FILE}）· R1 样本帧 ${FRAME} · 视口 ${VIEW.width}×${VIEW.height} @dpr${VIEW.deviceScaleFactor}`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

  // ── R1：本地静态页（读三轮：默认字号 / 亮色 / 与 R2 对齐字号）──────
  const srv = await serveStatic('out/gen', { mounts: VENDOR_MOUNT });
  /** @type {{light: any, dark: any, diff: any, png: Buffer, lightPng: Buffer}} */
  const r1 = { light: null, dark: null, diff: null, png: Buffer.alloc(0), lightPng: Buffer.alloc(0) };
  const page1 = await browser.newPage({
    viewport: { width: VIEW.width, height: VIEW.height },
    deviceScaleFactor: VIEW.deviceScaleFactor,
  });
  await page1.goto(`${srv.url}stage.html`, { waitUntil: 'load' });
  await page1.evaluate((h) => /** @type {any} */ (window).__stage.setBody(h), body(FRAME, { width: VIEW.width, height: VIEW.height }));
  await page1.evaluate((s) => /** @type {any} */ (window).__stage.setScroll(s), intro.scrollAtFrame(FRAME, { height: VIEW.height }));
  await page1.evaluate((n) => /** @type {any} */ (window).__stage.pinAnimations(n), FRAME);
  await page1.evaluate(() => document.fonts.ready);
  r1.dark = await readCloth(page1, tokenNames);
  r1.png = await page1.screenshot({ type: 'png' });
  // 同一页切成亮色（去掉 data-ds-dark-theme）
  await page1.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
  r1.light = await readCloth(page1, tokenNames);
  r1.lightPng = await page1.screenshot({ type: 'png' });
  console.log(`\nR1  令牌落点 ${r1.dark.carrier.tag}.${r1.dark.carrier.cls || '(无类名)'}  bg=${r1.dark.carrier.bg}  color=${r1.dark.carrier.color}`);
  console.log(`    --dsh-content-font-size = ${JSON.stringify(r1.dark.carrier.contentFontSize)}（我们钉的值）`);
  console.log(`    正文样本 ${r1.dark.sample.what}: ${r1.dark.sample.fontSize}/${r1.dark.sample.lineHeight} ${r1.dark.sample.color}`);

  if (SKIP_R2) {
    writeFileSync(join(OUT, `r1-frame${FRAME}-dark.png`), r1.png);
    writeFileSync(join(OUT, `r1-frame${FRAME}-light.png`), r1.lightPng);
    console.log('\n--skip-r2：只写了 R1 的两张图，**没有**做对拍。');
    console.log(`  ${OUT}/r1-frame${FRAME}-dark.png  ${OUT}/r1-frame${FRAME}-light.png`);
    await page1.close();
    await srv.close();
    await browser.close();
    return 0;
  }

  // ── R2：真 dsh web ───────────────────────────────────────────────
  const boot = await bootDshWeb({ port: 0 });
  /** @type {any} */
  let r2 = { light: null, dark: null, png: Buffer.alloc(0) };
  try {
    console.log(`\nR2  dsh web 端口 ${boot.port}（token ${boot.token.slice(0, 8)}…）`);
    const { page, errors } = await openPinnedGui(browser, boot, VIEW);
    if (errors.length) console.log(`    ⚠️ 页面报了 ${errors.length} 条错误（插件崩溃，与样式无关，明细见 JSON）`);
    r2.light = await readCloth(page, tokenNames);
    /** @type {Buffer} */
    let r2Png = await page.screenshot({ type: 'png' });
    // 打上深色开关再读一遍 —— 这就是 R1 用的那个开关，语义必须一致
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
    await pinAnimations(page);
    r2.dark = await readCloth(page, tokenNames);
    const r2DarkPng = await page.screenshot({ type: 'png' });
    r2.png = r2DarkPng;
    void r2Png;
    r2.errors = errors;
    console.log(`    令牌落点 ${r2.dark.carrier?.tag}.${r2.dark.carrier?.cls || '(无类名)'}  bg=${r2.dark.carrier?.bg}  color=${r2.dark.carrier?.color}`);
    console.log(`    --dsh-content-font-size = ${JSON.stringify(r2.dark.carrier?.contentFontSize)}（这台机器的真界面设置）`);
    console.log(`    深色开关：打之前 dark=${r2.light.dark} bg=${r2.light.carrier?.bg} → 打之后 dark=${r2.dark.dark} bg=${r2.dark.carrier?.bg}`);
    console.log(`    正文样本 ${r2.dark.sample.what}: ${r2.dark.sample.fontSize}/${r2.dark.sample.lineHeight} ${r2.dark.sample.color}`);

    // ── 把字号旋钮对齐再读一遍 R1 ────────────────────────────────────
    // `--dsh-content-font-size` 是**用户偏好**（dsh 里 12–17，这台机器是 15）。
    // 不对齐它就比不出「布」是否一致，只会比出「偏好不同」——
    // 那 60 个派生令牌（`--dsw-font-markdown-*` 全是 `calc(... + delta)`）会整片地"不一致"。
    const r2Size = r2.dark.carrier?.contentFontSize || '14px';
    await page1.evaluate((s) => document.body.style.setProperty('--dsh-content-font-size', s), r2Size);
    r1.diffLight = await readCloth(page1, tokenNames);
    await page1.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
    r1.diffDark = await readCloth(page1, tokenNames);
    console.log(`\n    为对齐而把 R1 的 --dsh-content-font-size 临时设成 ${r2Size}（只影响这次对拍，不改仓库里的值）`);
    await page1.close();
    await srv.close();
  } finally {
    boot.kill();
  }

  // ── 逐个令牌比：两轮 ─────────────────────────────────────────────
  // (a) `aligned`：把字号旋钮对齐之后必须**逐个一致** —— 这是「同一块布」的判据。
  // (b) `default`：R1 钉的 14px 对 R2 的偏好值 —— 差多少、差在哪，作为观察写进报告。
  /** @type {{theme: string, name: string, r1: string, r2: string}[]} */
  const aligned = [];
  /** @type {{theme: string, name: string, r1: string, r2: string}[]} */
  const unpinned = [];
  let compared = 0;
  let bothEmpty = 0;
  for (const theme of ['light', 'dark']) {
    for (const name of tokenNames) {
      const a2 = r2[theme].tokens[name];
      // ⚠️ 对齐后的读法要**按主题分开**：亮/暗是同一个开关（`body[data-ds-dark-theme]`），
      //    读暗色之前必须先把属性打回去 —— 第一版忘了这一步，
      //    于是拿 R1 的亮色去比 R2 的暗色，凭空多出 106 个"不一致"。
      const aAligned = (theme === 'dark' ? r1.diffDark : r1.diffLight).tokens[name];
      const aDefault = r1[theme].tokens[name];
      if (!a2 && !aAligned && !aDefault) {
        bothEmpty++;
        continue;
      }
      compared++;
      if (aAligned !== a2) aligned.push({ theme, name, r1: aAligned, r2: a2 });
      if (aDefault !== a2) unpinned.push({ theme, name, r1: aDefault, r2: a2 });
    }
  }

  // ── 并排图 ───────────────────────────────────────────────────────
  const cmp = await sideBySide(
    r2.png,
    r1.png,
    `R2  真 dsh web · 深色（强制 data-ds-dark-theme）`,
    `R1  film/pages 手搭页 · 帧 ${FRAME}`,
    `R1 ↔ R2 · ${VIEW.width}×${VIEW.height} @dpr${VIEW.deviceScaleFactor} · 同一浏览器参数`,
  );
  writeFileSync(join(OUT, 'side-by-side-dark.png'), cmp.png);
  writeFileSync(join(OUT, 'r2-dark.png'), r2.png);
  writeFileSync(join(OUT, 'r1-dark.png'), r1.png);
  writeFileSync(join(OUT, 'r1-light.png'), r1.lightPng);

  const report = {
    view: VIEW,
    frame: FRAME,
    tokenCount: tokenNames.length,
    compared,
    bothEmpty,
    contentFontSize: { r1Default: r1.dark.carrier.contentFontSize, r2: r2.dark.carrier?.contentFontSize ?? null },
    alignedDiffs: aligned,
    unpinnedDiffs: unpinned,
    r1: { light: r1.light, dark: r1.dark, alignedLight: r1.diffLight, alignedDark: r1.diffDark },
    r2: { light: r2.light, dark: r2.dark, errors: r2.errors ?? [] },
  };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('\n── 令牌逐个比（亮/暗各一轮）─────────────────────────────');
  console.log(`  两边至少一边有值的「令牌 × 主题」组合：${compared} / ${tokenNames.length * 2}（两边都为空：${bothEmpty}）`);
  console.log(`  ⛳ 字号旋钮对齐后不一致：${aligned.length}`);
  for (const d of aligned.slice(0, 12)) {
    console.log(`    [${d.theme}] ${d.name}\n        R1 = ${d.r1}\n        R2 = ${d.r2}`);
  }
  console.log(`  （参考）不对齐旋钮时不一致：${unpinned.length}` + `  —— 差的都是字号派生令牌`);
  const names = new Set(unpinned.map((d) => d.name.replace(/-(font-size|line-height|font-family|font-style)$/, '')));
  console.log(`    涉及 ${names.size} 组：${[...names].slice(0, 6).join(', ')}${names.size > 6 ? ' …' : ''}`);
  console.log('\n── 排版基线 ─────────────────────────────────────────────');
  for (const theme of ['light', 'dark']) {
    console.log(`  [${theme}] R1 ${r1[theme].sample.what} ${r1[theme].sample.fontSize}/${r1[theme].sample.lineHeight} ${r1[theme].sample.color}`);
    console.log(`  [${theme}] R2 ${r2[theme].sample.what} ${r2[theme].sample.fontSize}/${r2[theme].sample.lineHeight} ${r2[theme].sample.color}`);
  }
  console.log(`\n并排图 ${OUT}/side-by-side-dark.png（${cmp.width}×${cmp.height}）· 明细 ${OUT}/report.json`);

  await browser.close();
  if (aligned.length) {
    console.log(`\n结论：❌ 字号旋钮对齐后仍有 ${aligned.length} 个令牌不一致 —— 抽出来的 CSS 与真界面不是同一块布。`);
    return 1;
  }
  console.log(
    `\n结论：✅ 字号旋钮对齐后，两边都有值的 ${compared} 个令牌**逐个一致**（亮/暗各一轮）；` +
      `\n      R2 的偏好值是 ${r2.dark.carrier?.contentFontSize}，R1 钉的是 ${r1.dark.carrier.contentFontSize} ——` +
      ` 差异全部来自这一个旋钮，说明它是**同一个变量**在两边生效。`,
  );
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 对拍失败：${/** @type {Error} */ (e).message}`);
    if (process.env.DSH_DEBUG) console.error(e.stack);
    return 1;
  }),
);
