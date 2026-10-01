/**
 * film/check.js — 环境与素材自检（Phase 0 交付物）。
 *
 * 一条命令回答四个问题，**在渲任何一帧之前**：
 *   ① ffmpeg / ffprobe 到底解析到哪个路径、跑不跑得起来
 *   ② 两步 sha256（原曲 / 母版）对不对 —— 语义与 `tools/trim_song.py check` 完全一致
 *   ③ `@napi-rs/canvas` / `playwright` 的浏览器 / vendored 前端在不在
 *   ④ `clock.js` 的常量与 `Resource/song.json` 有没有漂移（帧数、fps）
 *
 * 退出码（与 `trim_song.py` 的约定保持一致，`AGENTS.md` §5）：
 *   0 通过（原曲不匹配只是警告）
 *   1 致命（母版不匹配 / 母版不是原曲前缀 / 依赖不可用）
 *   2 用法错误
 *
 * 用法：
 *   node film/check.js
 *   node film/check.js --src input/song.mp3 --master input/song.master.mp3
 *   node film/check.js --src-required        # 原曲缺失也算失败
 *   node film/check.js --no-vendor           # 跳过 vendored 前端校验
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { END_T, FPS, FRAME_COUNT, H, W, describe as describeClock } from './engine/clock.js';
import { hashFile } from './hash.js';
import { describeBinary, resolveFfmpegTools } from './lib/ffmpeg-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');

/**
 * vendored 前端的关键文件 sha256。
 *
 * 来源：`PersonalWorkaround/design-options.md` §1.9（**本地文件，不提交**）。
 * 这里只存指纹不存**文件名** —— 文件名带 hash，dsh 一升级就变（施工说明 §8 风险 3），
 * 所以文件名一律扫 `assets/` 现取，对本表的查法也是「扫出来的文件里，有没有这几个 hash」。
 * @type {Record<string,string>}
 */
const VENDOR_SHA256 = {
  '3c1468cbd07b1a818f2ad300b847a95a702cc1561c4646011f189376959241af': 'index-*.css',
  '9860041e810431da5a6b83e63f883ab8ff4fc49b4af3fc76681b46f778783a9f': 'vendor-*.css',
  '1f47db2d59dd8f6695cc0fe1277ef9b09ab613288c500d5ba63956f36f02e7fd': 'index-*.js',
  '38f95ea3ff85b49dc4d8f237db208bbaedd2cb8c31611215c246dde41786ff21': 'vendor-*.js',
};

/** Playwright 浏览器在 `%LOCALAPPDATA%\ms-playwright`（`AGENTS.md` §6）。 */
const PLAYWRIGHT_DIRS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
  join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.cache', 'ms-playwright'),
  join(process.env.HOME ?? process.env.USERPROFILE ?? '', 'Library', 'Caches', 'ms-playwright'),
].filter(/** @returns {p is string} */ (p) => Boolean(p));

/**
 * @typedef {Object} Report
 * @property {(msg: string) => void} ok
 * @property {(msg: string) => void} warn
 * @property {(msg: string) => void} fail
 * @property {() => number} code
 */

/** 累积结果的小报告器：致命项决定退出码，但**全部检查都跑完**再决定（一次看到所有问题）。 */
function makeReport() {
  let fatal = false;
  let warned = false;
  return {
    ok: (msg) => console.log(`  ✅ ${msg}`),
    warn: (msg) => {
      warned = true;
      console.log(`  ⚠️  ${msg}`);
    },
    fail: (msg) => {
      fatal = true;
      console.log(`  ❌ ${msg}`);
    },
    code: () => (fatal ? 1 : warned ? 0 : 0),
  };
}

/**
 * @param {string[]} argv
 * @returns {{src: string, master: string, resource: string, srcRequired: boolean, vendor: boolean, help: boolean}}
 */
function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const out = {
    src: 'input/song.mp3',
    master: 'input/song.master.mp3',
    resource: 'Resource/song.json',
    srcRequired: false,
    vendor: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--src':
        out.src = need(argv, ++i, a);
        break;
      case '--master':
        out.master = need(argv, ++i, a);
        break;
      case '--resource':
        out.resource = need(argv, ++i, a);
        break;
      case '--src-required':
        out.srcRequired = true;
        break;
      case '--no-vendor':
        out.vendor = false;
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      default:
        throw new UsageError(`未知参数 "${a}"（--help 看用法）`);
    }
  }
  return out;
}

/** 用法错误专用（退出码 2，与 trim_song.py 一致）。 */
class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {number} i
 * @param {string} flag
 * @returns {string}
 */
function need(argv, i, flag) {
  const v = argv[i];
  if (v === undefined) throw new UsageError(`${flag} 缺参数值`);
  return v;
}

function help() {
  console.log(
    [
      '用法：node film/check.js [选项]',
      '',
      '  --src <path>        原曲，默认 input/song.mp3',
      '  --master <path>     母版，默认 input/song.master.mp3',
      '  --resource <path>   指纹文件，默认 Resource/song.json',
      '  --src-required      原曲缺失也算失败（默认只是警告）',
      '  --no-vendor         跳过 vendored 前端 sha256 校验',
      '  -h, --help          这段文字',
      '',
      '退出码：0 通过 / 1 致命 / 2 用法错误',
    ].join('\n'),
  );
}

/** @param {string} p */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} p */
function sizeOf(p) {
  return statSync(p).size;
}

/**
 * 母版是原曲的字节前缀吗（`AGENTS.md` §3 的结构不变量）。
 * @param {string} srcPath
 * @param {string} masterPath
 * @returns {{ok: boolean, bytes: number, at?: number}}
 */
function isBytePrefix(srcPath, masterPath) {
  const a = readFileSync(srcPath);
  const b = readFileSync(masterPath);
  if (b.length > a.length) return { ok: false, bytes: b.length };
  const n = b.length;
  const eq = a.subarray(0, n).equals(b);
  return eq ? { ok: true, bytes: n } : { ok: false, bytes: n, at: firstDiff(a, b) };
}

/**
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {number} 首个不同字节的下标
 */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }
  if (args.help) {
    help();
    return 0;
  }

  const R = makeReport();
  console.log('── dsh-unhappy-pv · 环境与素材自检 ─────────────────────────');
  console.log(`仓库根  ${ROOT}`);
  console.log(`画布    ${describeClock()}`);
  console.log('');

  // ── ① 运行时 ────────────────────────────────────────────────
  console.log('[1/6] 运行时');
  console.log(`  Node    ${process.version}  (${process.execPath})`);
  console.log(`  平台    ${process.platform} ${process.arch}`);
  const require_ = createRequire(import.meta.url);

  /** @type {?{createCanvas: Function, version?: string}} */
  let canvas = null;
  try {
    const pkg = require_('@napi-rs/canvas/package.json');
    canvas = require_('@napi-rs/canvas');
    R.ok(`@napi-rs/canvas ${pkg.version} 可加载（Skia 原生二进制）`);
  } catch (e) {
    R.fail(`@napi-rs/canvas 加载失败：${/** @type {Error} */ (e).message}`);
    console.log('        hint: npm.cmd install  （原生依赖必须精确锁版本，见 AGENTS.md §2 规则 11）');
  }

  // 画布尺寸/像素格式的**最早**一次体检：不建画布，Phase 0 一行画面代码都不写。
  // 但常量本身要自洽（帧数与 END_T 必须互推一致），这条现在就查。
  if (Math.abs(END_T * FPS - FRAME_COUNT) > 1e-9) {
    R.fail(`clock.js 自相矛盾：round(END_T*FPS) = ${Math.round(END_T * FPS)} ≠ FRAME_COUNT = ${FRAME_COUNT}`);
  } else {
    R.ok(`clock.js 自洽：round(${END_T} × ${FPS}) = ${FRAME_COUNT} 帧（${W}×${H}）`);
  }
  console.log('');

  // ── ② ffmpeg / ffprobe ─────────────────────────────────────
  console.log('[2/6] ffmpeg / ffprobe（三级解析：环境变量 → 已知绝对路径 → PATH）');
  const { ffmpeg, ffprobe } = resolveFfmpegTools();
  console.log(`  ${describeBinary(ffmpeg).replace(/\n/g, '\n  ')}`);
  console.log(`  ${describeBinary(ffprobe).replace(/\n/g, '\n  ')}`);
  for (const bin of [ffmpeg, ffprobe]) {
    if (bin.via === 'unresolved') {
      R.fail(`找不到 ${bin.name}；设 $env:${bin.name.toUpperCase()} 或把 ffmpeg 放进 PATH`);
    } else if (bin.version && bin.version.startsWith('❌')) {
      R.fail(`${bin.name} 解析到 ${bin.path} 但跑不起来：${bin.version}`);
    } else {
      R.ok(`${bin.name} 可用（${bin.via === 'env' ? '环境变量' : bin.via === 'known' ? '已知路径' : 'PATH'}）`);
    }
  }
  console.log('');

  // ── ③ Resource/song.json 与 clock 的对齐 ────────────────────
  console.log('[3/6] 指纹文件与时间常量');
  /** @type {any} */
  let spec = null;
  const resourcePath = resolvePath(ROOT, args.resource);
  if (!isFile(resourcePath)) {
    R.fail(`找不到 ${resourcePath} —— 两步校验与帧数对账都做不了`);
  } else {
    try {
      spec = JSON.parse(readFileSync(resourcePath, 'utf8'));
      R.ok(`${args.resource} 可解析`);
    } catch (e) {
      R.fail(`${args.resource} 不是合法 JSON：${/** @type {Error} */ (e).message}`);
    }
  }

  if (spec) {
    const m = spec.master ?? {};
    // 已锁值：fps 24、4741 帧（2026-10-01）。这里故意把两边都print出来，
    // 因为「漂移」是唯一能悄悄把整片切错的方式。
    if (m.fps !== FPS) R.fail(`fps 漂移：clock.js = ${FPS}，Resource/song.json = ${m.fps}`);
    else R.ok(`fps 一致：${FPS}`);

    if (m.video_frames !== FRAME_COUNT) {
      R.fail(`总帧数漂移：clock.js = ${FRAME_COUNT}，Resource/song.json = ${m.video_frames}`);
    } else {
      R.ok(`总帧数一致：${FRAME_COUNT}`);
    }

    // 母版**故意**比 END_T 长一点：修剪工具取「能盖住整数个视频帧的最少 MPEG 帧」，
    // 所以 master.duration_s = END_T + overshoot，且 0 <= overshoot < 一个 MPEG 帧。
    // 验的不是「等于」，而是「盖住了，而且只多不到一个 MPEG 帧」。
    const audioS = Number(m.duration_s);
    const overshoot = audioS - END_T;
    const mp3FrameS = spec.samples_per_frame / spec.sample_rate; // 1152/48000 = 24 ms
    if (!(overshoot >= 0)) {
      R.fail(
        `母版比片长短：master.duration_s = ${audioS} < END_T = ${END_T}\n` +
          `        （音频短于视频时最后几帧没有声音；修剪工具的取法是「宁可多不能少」）`,
      );
    } else if (overshoot >= mp3FrameS) {
      R.fail(
        `母版比片长多出 ${(overshoot * 1000).toFixed(3)} ms ≥ 一个 MPEG 帧（${(mp3FrameS * 1000).toFixed(3)} ms）\n` +
          `        master.duration_s = ${audioS}，END_T = ${END_T}：修剪工具的 ceil 取法不该多这么多`,
      );
    } else {
      R.ok(
        `母版盖住片长：END_T = ${END_T} s，母版 ${audioS} s，` +
          `多 ${(overshoot * 1000).toFixed(2)} ms（< 一个 MPEG 帧 ${(mp3FrameS * 1000).toFixed(2)} ms，属正常）`,
      );
    }
    console.log(`  素材    ${spec.title ?? '(无标题)'} — ${spec.artist ?? '(无艺人)'}`);
    console.log(`  参数    ${spec.sample_rate} Hz · ${spec.bit_rate} bps · ${spec.samples_per_frame} 采样/帧 · ${spec.frame_bytes} 字节/帧`);
  }
  console.log('');

  // ── ④ 两步 sha256（语义与 trim_song.py check 一致）──────────
  console.log('[4/6] 两步 sha256（原曲不符只警告；母版不符是致命的）');
  const srcPath = resolvePath(ROOT, args.src);
  const masterPath = resolvePath(ROOT, args.master);
  const srcExists = isFile(srcPath);
  const masterExists = isFile(masterPath);

  if (!spec) {
    R.fail('没有可用的 Resource/song.json，跳过 sha256 校验');
  } else {
    if (srcExists) {
      const got = hashFile(srcPath);
      const want = String(spec.source.sha256).toLowerCase();
      if (got === want) {
        R.ok(`[1/2] 原曲 sha256 匹配：${got}`);
      } else {
        R.warn(
          `[1/2] 原曲 sha256 不匹配（唱词与切点可能漂移）\n` +
            `        实际 ${got}\n        期望 ${want}`,
        );
      }
    } else if (args.srcRequired) {
      R.fail(`[1/2] 找不到原曲 ${srcPath}`);
    } else {
      R.warn(`[1/2] 跳过：${args.src} 不在本机（原曲只在本地，仓库里只有它的 sha256）`);
    }

    if (!masterExists) {
      R.fail(
        `[2/2] 找不到母版 ${masterPath} —— 时间轴不可信，不要出片\n` +
          `        重新生成：node tools/trim-song.mjs make --src ${args.src} --out ${args.master} --fps ${FPS}`,
      );
    } else {
      const got = hashFile(masterPath);
      const want = String(spec.master.sha256).toLowerCase();
      if (got === want) {
        R.ok(`[2/2] 母版 sha256 匹配：${got}`);
      } else {
        R.fail(
          `[2/2] 母版 sha256 不匹配 —— 时间轴不可信，不要出片\n` +
            `        实际 ${got}\n        期望 ${want}\n` +
            `        重新生成：node tools/trim-song.mjs make --src ${args.src} --out ${args.master} --fps ${FPS}`,
        );
      }

      const bytes = sizeOf(masterPath);
      if (bytes === spec.master.bytes) {
        R.ok(`母版字节数匹配：${bytes.toLocaleString('en-US')}`);
      } else {
        R.fail(`母版字节数不符：实际 ${bytes}，Resource/song.json 记的是 ${spec.master.bytes}`);
      }

      if (srcExists) {
        const p = isBytePrefix(srcPath, masterPath);
        if (p.ok) {
          R.ok(`[结构] 母版是原曲的字节前缀（前 ${p.bytes.toLocaleString('en-US')} 字节）`);
        } else {
          R.fail(
            `[结构] 母版不是原曲的字节前缀：首个不同字节在下标 ${p.at} ` +
              `（前 ${p.bytes} 字节里）`,
          );
        }
      }
    }
  }
  console.log('');

  // ── ⑤ Playwright 浏览器 ────────────────────────────────────
  console.log('[5/6] Playwright');
  try {
    const pkg = require_('playwright/package.json');
    R.ok(`playwright ${pkg.version}`);
  } catch (e) {
    R.fail(`playwright 不可用：${/** @type {Error} */ (e).message}`);
  }
  /** @type {?string} */
  let browsersDir = null;
  for (const dir of PLAYWRIGHT_DIRS) {
    if (dir && existsSync(dir)) {
      browsersDir = dir;
      break;
    }
  }
  if (!browsersDir) {
    R.fail(`找不到 Playwright 浏览器目录（找过：${PLAYWRIGHT_DIRS.join(' | ')}）`);
  } else {
    const entries = readdirSafe(browsersDir);
    const chromium = entries.filter((d) => d.startsWith('chromium'));
    console.log(`  目录    ${browsersDir}`);
    console.log(`  浏览器  ${entries.join(', ') || '(空)'}`);
    if (chromium.length === 0) {
      R.fail('目录里没有 chromium —— npx.cmd playwright install chromium');
    } else {
      R.ok(`chromium 就绪：${chromium.join(', ')}`);
    }
  }
  console.log('');

  // ── ⑥ vendored 前端 ───────────────────────────────────────
  console.log('[6/6] vendored dsh 前端');
  if (!args.vendor) {
    console.log('  （--no-vendor：跳过）');
  } else {
    const vendorDir = join(ROOT, 'film', 'vendor', 'dsh-web-frontend');
    if (!existsSync(vendorDir)) {
      R.fail(`找不到 ${vendorDir}`);
    } else {
      // 扫目录现取文件名：**绝不硬编码 hash 文件名**（施工说明 §8 风险 3）
      const assets = readdirSafe(join(vendorDir, 'assets')).filter((f) => /\.(css|js)$/.test(f));
      /** @type {Map<string,string>} */
      const found = new Map();
      for (const f of assets) {
        found.set(hashFile(join(vendorDir, 'assets', f)), f);
      }
      let missing = 0;
      for (const [sha, label] of Object.entries(VENDOR_SHA256)) {
        if (found.has(sha)) R.ok(`${label.padEnd(12)} ${found.get(sha)}  sha256 ✓`);
        else {
          missing++;
          R.fail(`${label} 的 sha256 不在 assets/ 里 —— vendored 前端被换过或改过（期望 ${sha.slice(0, 12)}…）`);
        }
      }
      if (missing === 0) {
        // 字体目录不能裁：删了 @font-face 指向的 woff2 会静默回退到系统字体
        const fonts = readdirSafe(join(vendorDir, 'assets', 'fonts'));
        const woff2 = fonts.filter((f) => f.endsWith('.woff2'));
        if (woff2.length >= 3) R.ok(`assets/fonts/ 有 ${woff2.length} 个 woff2（@font-face 依赖它们，不能裁）`);
        else R.fail(`assets/fonts/ 只有 ${woff2.length} 个 woff2，CSS 里那 3 条 @font-face 会静默回退`);
      }
    }
  }
  console.log('');

  const code = R.code();
  console.log('───────────────────────────────────────────────────────────');
  console.log(code === 0 ? '结论：自检通过（原曲警告不影响出片）。' : '结论：自检失败 —— 上面 ❌ 的项必须先解决。');
  return code;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

process.exitCode = main();
