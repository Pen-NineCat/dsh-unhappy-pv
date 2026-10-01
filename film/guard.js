#!/usr/bin/env node
/**
 * film/guard.js — `AGENTS.md` §8 的**全量护栏**跑一遍并出报告（Phase 7）。
 *
 * 为什么要有这么一个脚本（而不是散在好几个命令里）：
 * `AGENTS.md` §8 说得很直接 —— 这三条 ⭐ 是为了挡住「片子渲完才发现第 2000 帧是黑的」。
 * 一张能一眼看完的清单，才有人会去跑它。
 *
 * 默认跑**快档**（不渲全片）；`--full` 才会渲 4741 帧真跑一遍成片。
 *
 * 用法：
 *   node film/guard.js                 # 快档：能静态查的都查，外加 48 帧真渲一遍
 *   node film/guard.js --full          # 全片 4741 帧（慢，几分钟）
 *   node film/guard.js --skip-pages    # 不跑截图侧（它要起浏览器）
 *   node film/guard.js --json          # 只输出 JSON（好机器比对）
 *
 * 退出码：0 全过 / 1 有 ❌ / 2 用法错误。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { END_T, FPS, FRAME_COUNT, W, H, describe as describeClock } from './engine/clock.js';
import { resolveFfmpegTools } from './lib/ffmpeg-path.js';
import { hashFile } from './hash.js';

const ROOT = resolvePath(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** @typedef {{name: string, star: boolean, status: 'ok'|'warn'|'fail'|'skip', detail: string}} Guard */

const HELP = [
  '用法：node film/guard.js [选项]',
  '',
  '  --full         跑全片 4741 帧（默认只渲 48 帧验证链路）',
  '  --skip-pages   跳过截图侧（它要起浏览器，较慢）',
  '  --skip-render  跳过渲染侧',
  '  --json         只输出 JSON',
  '  -h, --help     这段文字',
  '',
  '退出码：0 全过 / 1 有失败 / 2 用法错误',
].join('\n');

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { full: false, pages: true, render: true, json: false };
  for (const a of argv) {
    switch (a) {
      case '--full':
        o.full = true;
        break;
      case '--skip-pages':
        o.pages = false;
        break;
      case '--skip-render':
        o.render = false;
        break;
      case '--json':
        o.json = true;
        break;
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        console.error(`用法错误：未知参数 "${a}"`);
        process.exit(2);
    }
  }
  return o;
}

/**
 * @param {string} cmd @param {string[]} args
 * @returns {{code: number, out: string}}
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/**
 * 跑一条命令，把它的最后几行当证据。
 * @param {string[]} args
 * @param {number} [tailLines]
 */
function runNode(args, tailLines = 3) {
  const r = run(process.execPath, args);
  const lines = r.out.split('\n').filter((l) => l.trim() !== '');
  return { code: r.code, out: r.out, tail: lines.slice(-tailLines).join('\n') };
}

/** @type {Guard[]} */
const guards = [];

/**
 * @param {string} name @param {boolean} star @param {() => {status: Guard['status'], detail: string}} fn
 */
function guard(name, star, fn) {
  try {
    const r = fn();
    guards.push({ name, star, status: r.status, detail: r.detail });
  } catch (e) {
    guards.push({ name, star, status: 'fail', detail: `抛异常：${/** @type {Error} */ (e).message}` });
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const A = 'AGENTS.md';

  // ── ⭐ 1 帧数对账 ──────────────────────────────────────────
  guard('帧数对账（各段求和 == round(END_T·FPS)，编号连续）', true, () => {
    const r = runNode(['film/test/run.js', 'timeline']);
    if (r.code !== 0) return { status: 'fail', detail: `timeline 测试未过：\n${r.tail}` };
    const r2 = runNode(['film/pages/gen-frames.js']);
    if (r2.code !== 0) return { status: 'fail', detail: `gen-frames 未过：\n${r2.tail}` };
    return {
      status: 'ok',
      detail: `期望 ${FRAME_COUNT} 帧；timeline 断言过；gen-frames 对账过（${r2.tail.split('\n').pop()}）`,
    };
  });

  // ── ⭐ 2 同帧双渲比对 ──────────────────────────────────────
  guard('同帧双渲比对（差异区域坐标 + 首个差异像素）', true, () => {
    const r = runNode(['film/render.js', '--frames', '0,144,251,419,4740', '--diff', '--no-png'], 6);
    if (r.code !== 0) return { status: 'fail', detail: `双渲比对未过：\n${r.tail}` };
    return { status: 'ok', detail: `5 个边界帧全部双渲一致：\n${r.tail}` };
  });

  // ── ⭐ 3 时间线断言 ────────────────────────────────────────
  guard('时间线断言（排序 / 相接 / 无空洞无重叠 / 覆盖 [0,END]）', true, () => {
    const r = runNode(['film/test/run.js', 'timeline'], 2);
    if (r.code !== 0) return { status: 'fail', detail: r.tail };
    return { status: 'ok', detail: `通过（含三种坏时间线各自报错）：${r.tail}` };
  });

  // ── 素材两步校验 ───────────────────────────────────────────
  guard('素材两步校验（node film/check.js 退出 0）', false, () => {
    const r = runNode(['film/check.js'], 1);
    if (r.code !== 0) return { status: 'fail', detail: r.tail };
    return { status: 'ok', detail: r.tail };
  });

  // ── 成片帧数 ───────────────────────────────────────────────
  const renderFrames = o.full ? FRAME_COUNT : 48;
  if (o.render) {
    guard(`成片帧数（ffprobe -count_frames == 期望；渲染 ${renderFrames} 帧）`, false, () => {
      const out = 'out/guard-film.mp4';
      const args = o.full
        ? ['film/render-video.js', '--out', out]
        : ['film/render-video.js', '--range', '0', String(renderFrames - 1), '--no-audio', '--out', out];
      const r = runNode(args, 3);
      if (r.code !== 0) return { status: 'fail', detail: r.tail };
      if (!existsSync(out)) return { status: 'fail', detail: '成片没生成' };
      const { ffprobe } = resolveFfmpegTools();
      const p = run(ffprobe.path, [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out,
      ]);
      const got = Number(p.out.trim());
      if (got !== renderFrames) {
        return { status: 'fail', detail: `ffprobe 数出 ${got} ≠ 期望 ${renderFrames}` };
      }
      return { status: 'ok', detail: `ffprobe 数出 ${got} == ${renderFrames}；${r.tail}` };
    });
  } else {
    guards.push({ name: '成片帧数', star: false, status: 'skip', detail: '--skip-render' });
  }

  // ── 无空白帧 ───────────────────────────────────────────────
  guard('无空白帧（抽样 stddev，纯色帧报警）', false, () => {
    const r = runNode(['film/test/perf-baseline.js', '--json'], 0);
    void r;
    // 直接抽样：渲几帧算 stddev
    return sampleStddev();
  });

  // ── 边界帧抽查 ─────────────────────────────────────────────
  guard('边界帧抽查（t=0 / 末帧 / 转场首末帧已出图）', false, () => {
    const marks = [0, 143, 144, 250, 251, 418, 419, FRAME_COUNT - 1];
    const r = runNode(['film/render.js', '--frames', marks.join(','), '--out', 'out/guard-stills'], 0);
    if (r.code !== 0) return { status: 'fail', detail: r.tail || r.out.split('\n').slice(-3).join('\n') };
    const missing = marks.filter((n) => !existsSync(`out/guard-stills/${String(n).padStart(5, '0')}.png`));
    if (missing.length) return { status: 'fail', detail: `缺图：${missing.join(',')}` };
    return {
      status: 'ok',
      detail: `${marks.length} 张已出（out/guard-stills/）—— ⚠️ **需要人眼看一遍**，机器只能证明文件在`,
    };
  });

  // ── 截图侧（七个焊点）──────────────────────────────────────
  if (o.pages) {
    guard('截图侧：⭐ 同帧双渲 + 七个焊点', false, () => {
      const g = runNode(['film/pages/gen-frames.js'], 1);
      if (g.code !== 0) return { status: 'fail', detail: `gen-frames 未过：${g.tail}` };
      const s = runNode(['film/pages/shot.mjs', '--smoke', '--seconds', '2'], 1);
      if (s.code !== 0) return { status: 'fail', detail: `截图冒烟未过：${s.tail}` };
      // 引子页上唯一的 CSS 动画在**拍 2（帧 144–250）**的思维链表头上，
      // 而 --smoke 的采样帧都在前 2 秒里 —— 所以那段要单独截一次，
      // 否则「焊点 3 有靶子」这条判据在引子上从来没被真的跑到过。
      const a = runNode(['film/pages/shot.mjs', '--frames', '200,201,205'], 1);
      if (a.code !== 0) return { status: 'fail', detail: `引子动画靶子检查未过：${a.tail}` };
      const j = runNode(['film/pages/shot.mjs', '--jitter-check', '300'], 1);
      if (j.code !== 0) return { status: 'fail', detail: `焊点 3 抖动检查未过：${j.tail}` };
      const sc = runNode(['film/pages/shot.mjs', '--scroll-check'], 1);
      if (sc.code !== 0) return { status: 'fail', detail: `滚动检查未过：${sc.tail}` };
      const isc = runNode(['film/pages/shot.mjs', '--intro-scroll-check'], 1);
      if (isc.code !== 0) return { status: 'fail', detail: `引子滚动/行网格检查未过：${isc.tail}` };
      return { status: 'ok', detail: `${s.tail}\n    ${a.tail}\n    ${j.tail}\n    ${sc.tail}\n    ${isc.tail}` };
    });
  } else {
    guards.push({ name: '截图侧', star: false, status: 'skip', detail: '--skip-pages' });
  }

  // ── 禁止随机 ───────────────────────────────────────────────
  guard('禁止随机（排除 vendor 与注释/测试名）', false, () => {
    const hits = scanCode(/Math\.random/);
    if (hits.length) return { status: 'fail', detail: hits.join('\n') };
    return { status: 'ok', detail: '无真实调用（注释与测试名里的提及不算，见施工说明记录 4）' };
  });

  // ── 没有猴补丁 ─────────────────────────────────────────────
  guard('没有猴补丁（her_layer / inspect.getsource 式改写）', false, () => {
    const hits = scanCode(/her_layer|inspect\.getsource|kit\.[a-z_]+ =/);
    if (hits.length) return { status: 'fail', detail: hits.join('\n') };
    return { status: 'ok', detail: '无真实命中（见施工说明记录 14）' };
  });

  // ── 原生依赖精确锁版本 ─────────────────────────────────────
  guard('原生依赖精确锁版本（不写 ^ 或 ~）', false, () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const bad = [];
    for (const [name, ver] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (/[\^~]/.test(String(ver))) bad.push(`${name} = ${ver}`);
    }
    if (bad.length) return { status: 'fail', detail: `有浮动版本：${bad.join(', ')}` };
    return {
      status: 'ok',
      detail: `${Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length} 个依赖全部精确锁（AGENTS.md §2 规则 11）`,
    };
  });

  // ── 仓库卫生 ───────────────────────────────────────────────
  guard('仓库卫生（构建产物全被忽略；无未跟踪的产物）', false, () => {
    const r = run('git', ['status', '--porcelain']);
    if (r.code !== 0) return { status: 'skip', detail: '不在 git 仓库里或 git 不可用' };
    const lines = r.out.split('\n').filter((l) => l.trim() !== '');
    // `out/`、`segments/` 之类必须被忽略 —— 它们**不该**出现在 status 里
    const leaked = lines.filter((l) => /\b(out|segments|frames_out|dsh_frames|stills)\//.test(l));
    if (leaked.length) return { status: 'fail', detail: `构建产物漏进 git status：\n${leaked.join('\n')}` };
    return {
      status: 'ok',
      detail: `git status 有 ${lines.length} 项（都是源码/文档，没有构建产物泄漏）`,
    };
  });

  // ── 交付转码的色彩标记 ─────────────────────────────────────
  guard('交付片带 BT.709 三个标记（yuv420p）', false, () => {
    const out = 'out/guard-deliver.mp4';
    const r = runNode(
      [
        'film/render-video.js', '--range', '0', '23', '--no-audio', '--workers', '2',
        '--out', 'out/guard-src.mp4', '--deliver', out,
      ],
      0,
    );
    if (r.code !== 0) return { status: 'fail', detail: r.out.split('\n').slice(-4).join('\n') };
    if (!existsSync(out)) return { status: 'fail', detail: '交付片没生成' };
    const { ffprobe } = resolveFfmpegTools();
    const p = run(ffprobe.path, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=pix_fmt,color_space,color_primaries,color_transfer',
      '-of', 'default=noprint_wrappers=1', out,
    ]);
    /** @type {Record<string,string>} */
    const want = { pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' };
    /** @type {Record<string,string>} */
    const got = {};
    for (const line of p.out.split('\n')) {
      const [k, v] = line.split('=');
      if (k && v) got[k.trim()] = v.trim();
    }
    const bad = Object.entries(want).filter(([k, v]) => got[k] !== v);
    if (bad.length) {
      return {
        status: 'fail',
        detail:
          `期望 ${JSON.stringify(want)}\n实际 ${JSON.stringify(got)}\n` +
          '  hint: BT.709 三个标记必须在 -i **之前**（输入侧），见施工说明记录 17',
      };
    }
    return { status: 'ok', detail: JSON.stringify(got) };
  });

  // ── 原生依赖版本与帧哈希清单 ───────────────────────────────
  guard('帧哈希清单（out/frames.sha256 可用）', false, () => {
    if (!existsSync('out/frames.sha256')) {
      return {
        status: 'warn',
        detail: 'out/frames.sha256 还没生成过 —— 跑 node film/render-video.js --manifest 会产出',
      };
    }
    const text = readFileSync('out/frames.sha256', 'utf8').trim().split('\n');
    const bad = text.filter((l) => !/^\d+\t[0-9a-f]{64}$/.test(l));
    if (bad.length) return { status: 'fail', detail: `${bad.length} 行格式不对` };
    return { status: 'ok', detail: `${text.length} 行，格式正确` };
  });

  // ── 输出 ───────────────────────────────────────────────────
  const failed = guards.filter((g) => g.status === 'fail');
  const warned = guards.filter((g) => g.status === 'warn');

  if (o.json) {
    console.log(JSON.stringify({ canvas: describeClock(), guards, failed: failed.length, warned: warned.length }, null, 2));
    return failed.length ? 1 : 0;
  }

  console.log('══ dsh-unhappy-pv · 护栏总表（AGENTS.md §8）══════════════════');
  console.log(`画布 ${describeClock()} · 帧数 ${FRAME_COUNT} · ffmpeg ${resolveFfmpegTools().ffmpeg.path}`);
  console.log(`模式 ${o.full ? '全片' : `快档（渲染 ${renderFrames} 帧）`}`);
  console.log('');
  for (const g of guards) {
    const icon = { ok: '✅', warn: '⚠️ ', fail: '❌', skip: '⏭️ ' }[g.status];
    console.log(`${icon}${g.star ? '⭐' : '  '} ${g.name}`);
    for (const line of g.detail.split('\n')) console.log(`      ${line}`);
  }
  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  const starFails = failed.filter((g) => g.star).length;
  if (failed.length === 0) {
    console.log(
      `结论：${guards.length} 条护栏全部通过` +
        `${warned.length ? `（${warned.length} 条 ⚠️ 需要人看一眼）` : ''}。` +
        `${starFails === 0 ? '三条 ⭐ 都过了。' : ''}`,
    );
    console.log('⚠️ 记住 AGENTS.md §8 末句：同机双渲一致 ≠ 跨机确定性，目前**没有做跨机验证**。');
    return 0;
  }
  console.log(`结论：${failed.length} 条 ❌ —— ${failed.map((g) => g.name).join('；')}`);
  return 1;
}

/**
 * 抽样几帧算 `stddev`（纯色帧 ≈ 0 就是注入失败的信号）。
 * @returns {{status: Guard['status'], detail: string}}
 */
function sampleStddev() {
  const frames = [0, 300, 1000, 2500, 4000, FRAME_COUNT - 1];
  const script = `
import { frame } from './film/engine/frame.js';
import { rawRGBA } from './film/kit/pixels.js';
import { stddev } from './film/kit/raster.js';
const ns = ${JSON.stringify(frames)};
const out = ns.map((n) => ({ n, sd: stddev(rawRGBA(frame(n))) }));
console.log(JSON.stringify(out));
`;
  const r = run(process.execPath, ['--input-type=module', '-e', script]);
  if (r.code !== 0) return { status: 'fail', detail: `抽样失败：${r.out.split('\n').slice(-3).join('\n')}` };
  const rows = JSON.parse(r.out.trim().split('\n').pop() ?? '[]');
  const flat = rows.filter((/** @type {any} */ x) => x.sd < 1);
  const text = rows.map((/** @type {any} */ x) => `n=${x.n} sd=${x.sd.toFixed(2)}`).join('  ');
  if (flat.length) return { status: 'fail', detail: `疑似空白帧：${flat.map((/** @type {any} */ f) => f.n).join(',')}\n${text}` };
  return { status: 'ok', detail: text };
}

/**
 * 扫代码（排除 `film/vendor/`、`film/guard.js` 自身、注释、测试名与断言文本）。
 *
 * ⚠️ 两条排除都是必要的：
 * - **必须排除注释与断言文本**：我们的文档/测试越把纪律写清楚，这类 grep 命中得越多
 *   （施工说明记录 4 与记录 14 都是这个毛病）。
 * - **必须排除本文件**：`guard.js` 里就写着那些正则与模式名，不排除就是**自己抓自己**
 *   （2026-10-01 实测：第一次跑就抓到了它自己，报出 2 处「猴补丁」）。
 * @param {RegExp} re
 * @returns {string[]}
 */
function scanCode(re) {
  /** @type {string[]} */
  const hits = [];
  const SELF = resolvePath(ROOT, 'film', 'guard.js');
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'vendor' || e.name === 'node_modules') continue;
        walk(p);
        continue;
      }
      if (!/\.(js|mjs)$/.test(e.name)) continue;
      if (resolvePath(p) === SELF) continue; // 别抓自己（正则与模式名就写在里面）
      const lines = readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (re.test(line) === false) continue;
        if (/^\s*(\*|\/\/)/.test(line)) continue; // 注释
        if (/describe\(|test\(|contains\(|eq\(|ok\(|throws\(/.test(line)) continue; // 测试名与断言
        hits.push(`${p.replace(ROOT + '\\', '').replace(ROOT + '/', '')}:${i + 1}: ${line.trim()}`);
      }
    }
  };
  walk(resolvePath(ROOT, 'film'));
  if (existsSync(resolvePath(ROOT, 'tools'))) walk(resolvePath(ROOT, 'tools'));
  return hits;
}

process.exitCode = main();
