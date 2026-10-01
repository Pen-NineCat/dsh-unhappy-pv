#!/usr/bin/env node
/**
 * film/pages/preview.mjs — 把 `shot.mjs` 的整段 PNG 序列变成**能人眼过一遍**的三样东西。
 *
 * 420 张 1920×1280 的 PNG 一页页翻是没法"检查全部帧"的，所以：
 *
 * | 产物 | 用途 | 能看出什么 |
 * |---|---|---|
 * | **全览表** `sheet-*.png` | 一张图里放下整段（每格带帧号） | 空白帧、构图跳变、某一拍整段没动、末尾没收干净 |
 * | **预览片** `preview-*.mp4` | 24 fps 按真实节奏播一遍 | **只有它能把"逐帧"暴露出来**：抖动、滚动忽快忽慢、某一帧闪一下 |
 * | `preview.json` | 逐帧「本帧相对上一帧变了没有」 | 节奏（哪几帧在吐字）、有没有该连续却断了的地方 |
 *
 * ⚠️ 它**不是成片管线的一部分**：预览片是 `yuv420p + crf` 的有损编码，
 * 成片走 `film/render-video.js`（分段 + concat 不重编码，母版无损）。
 * 这里唯一的目标是**让人看得见**。
 *
 * 用法：
 *   node film/pages/preview.mjs --range 0 419               # 表 + 预览片都做
 *   node film/pages/preview.mjs --range 0 419 --cols 14     # 表更宽
 *   node film/pages/preview.mjs --range 0 419 --sheet-only
 *   node film/pages/preview.mjs --range 0 419 --mp4-only
 *
 * 退出码：0 成功 / 1 失败（含 ⭐ 帧号不连续）/ 2 用法错误。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { FPS } from '../engine/clock.js';
import { boxDownsample } from '../kit/raster.js';
import { rawRGBA } from '../kit/pixels.js';
import { resolveFfmpegTools } from '../lib/ffmpeg-path.js';

/** 用法错误（退出码 2）。 */
class UsageError extends Error {}

const HELP = [
  '用法：node film/pages/preview.mjs [选项]',
  '',
  '  --range A B    要处理的帧区间（含 A、含 B），默认 0 419（整个引子）',
  '  --frames 1,2,3 只要这几帧',
  '  --shots <dir>  PNG 所在目录，默认 out/shots',
  '  --out <dir>    产物目录，默认 out/preview',
  '  --cols N       全览表列数，默认 20（行数按帧数算出来）',
  '  --cell N       全览表单格宽（px），默认 192；高度按截图比例算',
  '  --crf N        预览片质量，默认 18（越小越清楚）',
  '  --sheet-only   只做全览表',
  '  --mp4-only     只做预览片',
  '  -h, --help     这段文字',
  '',
  '退出码：0 成功 / 1 失败 / 2 用法错误',
].join('\n');

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = {
    frames: /** @type {?number[]} */ (null),
    shots: 'out/shots',
    out: 'out/preview',
    cols: 20,
    cell: 192,
    crf: 18,
    sheet: true,
    mp4: true,
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
      case '--shots':
        o.shots = argv[++i] ?? o.shots;
        break;
      case '--out':
        o.out = argv[++i] ?? o.out;
        break;
      case '--cols':
      case '--cell':
      case '--crf': {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${a} 要是正数`);
        if (a === '--cols') o.cols = Math.round(n);
        else if (a === '--cell') o.cell = Math.round(n);
        else o.crf = n;
        break;
      }
      case '--sheet-only':
        o.mp4 = false;
        break;
      case '--mp4-only':
        o.sheet = false;
        break;
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new UsageError(`未知参数 "${a}"`);
    }
  }
  if (!o.frames) o.frames = Array.from({ length: 420 }, (_, i) => i);
  return o;
}

/**
 * 全览表：每帧一块，`boxDownsample` 缩到单格大小。
 *
 * ⚠️ 缩图**不用** `ctx.drawImage` 缩小去凑：那是双线性/面积混合，与 `Image.BOX` 不同
 * （`AGENTS.md` §7）。这里用 `kit/raster.js` 里已经写好并测过的 `boxDownsample`。
 * @param {number[]} frames
 * @param {{cols: number, cell: number, shots: string, out: string}} o
 */
async function buildSheet(frames, o) {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const dir = resolvePath(o.shots);
  const first = await loadImage(join(dir, `${String(frames[0]).padStart(5, '0')}.png`));
  const cellH = Math.max(1, Math.round((o.cell * first.height) / first.width));
  const rows = Math.ceil(frames.length / o.cols);
  const pad = 6;
  const labelH = 16;
  const W = o.cols * (o.cell + pad) + pad;
  const H = rows * (cellH + labelH + pad) + pad;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px "Microsoft YaHei", monospace';

  /** @type {string[]} */
  const missing = [];
  for (let i = 0; i < frames.length; i++) {
    const n = frames[i];
    const file = join(dir, `${String(n).padStart(5, '0')}.png`);
    const x = pad + (i % o.cols) * (o.cell + pad);
    const y = pad + Math.floor(i / o.cols) * (cellH + labelH + pad);
    if (!existsSync(file)) {
      missing.push(String(n));
      continue;
    }
    const img = await loadImage(readFileSync(file));
    const full = createCanvas(img.width, img.height);
    full.getContext('2d').drawImage(img, 0, 0);
    const small = boxDownsample(rawRGBA(full), o.cell, cellH);
    const cell = createCanvas(o.cell, cellH);
    const cctx = cell.getContext('2d');
    const id = cctx.createImageData(o.cell, cellH);
    id.data.set(small.data);
    cctx.putImageData(id, 0, 0);
    ctx.fillStyle = '#8b949e';
    ctx.fillText(String(n), x + 1, y + 2);
    ctx.drawImage(cell, x, y + labelH);
  }
  const name = `sheet-${String(frames[0]).padStart(5, '0')}-${String(frames[frames.length - 1]).padStart(5, '0')}.png`;
  writeFileSync(join(resolvePath(o.out), name), cv.toBuffer('image/png'));
  return { name, width: W, height: H, cellH, missing };
}

/**
 * 预览片：PNG 序列 → 24 fps mp4。
 *
 * `-frames:v` 显式定长（`AGENTS.md` §7：片长由帧数决定，不由别的决定）；
 * `-start_number` 必须给，否则区间不从 0 开始时 ffmpeg 会自己去找第一个编号。
 * @param {number[]} frames @param {{crf: number, shots: string, out: string}} o
 */
function buildMp4(frames, o) {
  const tools = resolveFfmpegTools();
  if (!tools.ffmpeg.path) {
    throw new Error(
      '找不到 ffmpeg。\n  hint: 设环境变量 FFMPEG，或装到 E:\\ffmpeg\\bin（见 AGENTS.md §6）',
    );
  }
  const dir = resolvePath(o.shots);
  const name = `preview-${String(frames[0]).padStart(5, '0')}-${String(frames[frames.length - 1]).padStart(5, '0')}.mp4`;
  const outFile = join(resolvePath(o.out), name);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-start_number', String(frames[0]),
    '-i', join(dir, '%05d.png'),
    '-frames:v', String(frames.length),
    '-c:v', 'libx264',
    '-crf', String(o.crf),
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outFile,
  ];
  const r = spawnSync(tools.ffmpeg.path, args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg 退出码 ${r.status}：\n${(r.stderr || '').trim().split('\n').slice(-6).join('\n')}\n` +
        `  hint: 命令是 ${tools.ffmpeg.path} ${args.join(' ')}`,
    );
  }
  return { name, bytes: readFileSync(outFile).length };
}

/**
 * 逐帧「相对上一帧变了没有」——检查节奏用。
 * 判据是 PNG 的 sha256；同帧双渲一致时，它就是**帧指纹**。
 * @param {number[]} frames @param {string} shots
 */
function timeline(frames, shots) {
  const dir = resolvePath(shots);
  /** @type {{n: number, hash: string, changed: boolean, repeatOf: ?number}[]} */
  const rows = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const n of frames) {
    const file = join(dir, `${String(n).padStart(5, '0')}.png`);
    const hash = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : '(缺文件)';
    const prev = rows[rows.length - 1];
    const changed = !prev || prev.hash !== hash;
    const firstSeen = seen.get(hash);
    rows.push({ n, hash, changed, repeatOf: changed && firstSeen !== undefined ? firstSeen : null });
    if (!seen.has(hash)) seen.set(hash, n);
  }
  return rows;
}

/** 把一串帧号压成 `0-3, 7, 10-12` 这样的区间文本。 */
function ranges(/** @type {number[]} */ ns) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < ns.length) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j === i ? String(ns[i]) : `${ns[i]}–${ns[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }
  mkdirSync(resolvePath(o.out), { recursive: true });
  const shotsDir = resolvePath(o.shots);
  const last = o.frames[o.frames.length - 1];
  if (!existsSync(shotsDir)) {
    console.error(`缺少 ${o.shots}/ —— 先跑：node film/pages/shot.mjs --range ${o.frames[0]} ${last} --out ${o.shots}`);
    return 1;
  }

  // ⭐ 帧数对账：编号连续、一张不缺（缺一张要在**这里**报出来，不是等成片渲完）
  const present = new Set(
    readdirSync(shotsDir)
      .filter((f) => /^\d{5}\.png$/.test(f))
      .map((f) => Number(f.slice(0, 5))),
  );
  const missing = o.frames.filter((n) => !present.has(n));
  console.log(`帧     ${o.frames.length} 帧（${o.frames[0]}..${last}）· 目录 ${o.shots}/（共 ${present.size} 张 PNG）`);
  if (missing.length) {
    console.error(`⭐ 帧号对账失败：缺 ${missing.length} 张 —— ${ranges(missing)}`);
    return 1;
  }
  console.log('       ✅ 帧号连续、一张不缺');

  const rows = timeline(o.frames, o.shots);
  const changed = rows.filter((r) => r.changed).map((r) => r.n);
  const repeats = rows.filter((r) => r.repeatOf !== null);
  console.log(`节奏   ${changed.length} 帧在变、${rows.length - changed.length} 帧与上一帧逐像素相同`);
  console.log(`       在变的帧：${ranges(changed)}`);
  if (repeats.length) {
    console.log(
      `       ⚠️ ${repeats.length} 帧的画面**回到过更早的某一帧**（画面非单调，可能是 bug）：` +
        repeats.slice(0, 8).map((r) => `${r.n}←${r.repeatOf}`).join(', '),
    );
  }

  if (o.sheet) {
    const s = await buildSheet(o.frames, o);
    console.log(`全览表 ${o.out}/${s.name}  ${s.width}×${s.height}（单格 ${o.cell}×${s.cellH}）`);
    if (s.missing.length) console.log(`       ⚠️ 有 ${s.missing.length} 帧缺文件，那些格子是空的`);
  }
  let mp4 = null;
  if (o.mp4) {
    mp4 = buildMp4(o.frames, o);
    console.log(`预览片 ${o.out}/${mp4.name}  ${(mp4.bytes / 1024 / 1024).toFixed(1)} MB · ${(o.frames.length / FPS).toFixed(2)} s @ ${FPS} fps`);
  }

  // 明细文件名带区间 —— 否则跑第二个区间会把第一个区间的明细覆盖掉（踩过一次）
  const tag = `${String(o.frames[0]).padStart(5, '0')}-${String(last).padStart(5, '0')}`;
  writeFileSync(
    join(resolvePath(o.out), `preview-${tag}.json`),
    JSON.stringify(
      {
        shots: o.shots,
        range: [o.frames[0], last],
        count: o.frames.length,
        fps: FPS,
        changedFrames: changed,
        pixelIdenticalToPrev: rows.length - changed.length,
        nonMonotoneRepeats: repeats.map((r) => ({ n: r.n, repeatOf: r.repeatOf })),
        sheet: o.sheet ? { cols: o.cols, cell: o.cell } : null,
        mp4: mp4 ? { file: mp4.name, bytes: mp4.bytes } : null,
        frames: rows.map((r) => ({ n: r.n, hash: r.hash.slice(0, 16), changed: r.changed })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`明细   ${o.out}/preview-${tag}.json`);
  console.log('');
  console.log('人眼建议的顺序：先看全览表找异常帧号 → 再看预览片确认节奏 → 只在需要时去翻单帧 PNG。');
  return 0;
}

process.exit(await main());
