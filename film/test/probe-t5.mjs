#!/usr/bin/env node
/**
 * film/test/probe-t5.mjs — **T5 的验收图**：把三格、memory 的两行、以及**她**合成成整幅。
 *
 * 画面规格 §1.2 给 T5 的判据是「过程可见：字逐字出现又退掉、**memory 多两行**、
 * **鼠标落点与时刻正确**」。前一条看左格（网页截图），后两条看这一张合成图。
 *
 * ## 它走的是**真合成路径**，不是另写一套
 *
 * `frameAsync(n, null, { trackLayers })` + `film/compose/track-layer.js` + `shots.js`：
 * 与 `film/render-video.js` 用的是同一条路（左格截图由 track-layer 贴进 **subject**，
 * 六层顺序照旧）。这一点很重要 —— 她画在 `chrome` 这一层，**只有在真的六层合成里**
 * 才能证明"她压在那张网页截图之上"，自己拼图是证明不了的。
 *
 * ## 为什么还要出特写
 *
 * 她只有 **12×19 px**（真鼠标的实机尺寸，见 `content/cursor.js` 文件头）。
 * 在一张 1920×1080 的图里，人眼很难判断"这是箭头还是 I-beam"，
 * 所以每帧另外出两小块：**光标特写 ×4** 与 **memory 面板 1:1**。
 *
 * 用法：
 *   node film/test/probe-t5.mjs                          # 默认帧表
 *   node film/test/probe-t5.mjs --frames 419,441,483,670
 *   node film/test/probe-t5.mjs --shots out/t5shots --out out/t5
 *   node film/test/probe-t5.mjs --shapes                 # 只出三种形状的放大对照条
 *   node film/test/probe-t5.mjs --dsf-compare            # 2× 截图缩回 1× 的两种做法对比
 *
 * 前置：`node film/pages/shot.mjs --track dsh --frames ... --out out/t5shots`
 * 退出码：0 成功 / 1 缺截图或校验不过 / 2 用法错误。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { H, W } from '../engine/clock.js';
import { frameAsync } from '../engine/frame.js';
import { boxDownsample, readRaw, writeRawTo } from '../kit/raster.js';
import { blitRect, createLayer, ctx2d, encodePng } from '../kit/canvas.js';
import { openShotSource } from '../compose/shots.js';
import { makeTrackLayerFn } from '../compose/track-layer.js';
import { drawCursorShape } from '../content/cursor.js';
import { drawMemory, memoryRowsAt } from '../content/memory.js';
import { CELLS, LEFT_W } from '../engine/layout.js';
import { makeStack } from '../engine/layers.js';
import { cursorAt } from '../engine/cursor.js';

const FPS = 24;

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ n, /** @type {any} */ d) => {
  const i = argv.indexOf(n);
  return i < 0 ? d : argv[i + 1];
};
const OUT_DEFAULT = 'out/t5';
const SHOTS = String(flag('--shots', 'out/t5shots'));
const DPR = Number(flag('--dpr', 2)) || 2;
const FRAMES = String(flag('--frames', '419,430,441,461,470,483,484,490,498,586,642,700'))
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));
const ONLY_SHAPES = argv.includes('--shapes');
const DSF_COMPARE = argv.includes('--dsf-compare');

/**
 * `--range A B`：**整段**导出（命名 `<帧号5位>.png`，可以直接喂 `preview.mjs` 出全览表与预览片）。
 * 参考项目最实用的开关就是"只重渲某几帧"，而 T5 的判据里有两条是**过程**（字逐字出现又退掉、
 * 她从框里移出去），过程只能看整段。
 */
const RANGE_MODE = argv.includes('--range');
const RANGE = RANGE_MODE
  ? [Number(argv[argv.indexOf('--range') + 1]), Number(argv[argv.indexOf('--range') + 2])]
  : [419, 802];
if (RANGE_MODE && (!Number.isInteger(RANGE[0]) || !Number.isInteger(RANGE[1]) || RANGE[1] < RANGE[0])) {
  console.error('用法错误：--range A B 都要是整数，且 B >= A');
  process.exit(2);
}
/** 输出目录：整段模式默认另一个目录（帧名是 `<帧号5位>.png`，别和特写混在一起）。 */
const OUT = String(flag('--out', RANGE_MODE ? 'out/t5frames' : OUT_DEFAULT));

/** 出现/退格证据条用的帧（覆盖：起步 1 个字 → 出完 → 停在框里 → 删到空）。 */
const TYPING_FRAMES = String(flag('--typing-frames', '419,421,425,430,435,441,450,461,466,470,475,479,483'))
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));

/** 放大 N 倍（最近邻；要看的是**像素**，不是插值后的柔光）。 */
function zoom(src, k) {
  const out = createLayer(src.width * k, src.height * k);
  blitRect(out, src, 0, 0, src.width, src.height, 0, 0, out.width, out.height, { smooth: false });
  return out;
}

/**
 * 三种形状的放大对照条（×8）—— 手型这一版**没有任何一帧用到**，
 * 所以只能这样让人眼看一眼它长什么样。
 * @returns {string} 落盘路径
 */
function shapesSheet() {
  const K = 8;
  const TILE = 32;
  const CELL = TILE * K;
  const cv = createLayer(CELL * 3, CELL);
  const ctx = ctx2d(cv);
  ctx.fillStyle = '#151517';
  ctx.fillRect(0, 0, cv.width, cv.height);
  // 每个形状的**热区**摆在格子里不越界的位置（箭头与手型的尖端在上、I-beam 在正中）
  const spots = { arrow: [10, 5], ibeam: [16, 16], hand: [10, 5] };
  const names = /** @type {const} */ (['arrow', 'ibeam', 'hand']);
  names.forEach((shape, i) => {
    const tile = createLayer(TILE, TILE);
    drawCursorShape(tile, shape, spots[shape][0], spots[shape][1], { scale: 1 });
    blitRect(cv, tile, 0, 0, TILE, TILE, i * CELL, 0, CELL, CELL, { smooth: false });
  });
  const file = join(resolvePath(OUT), 'cursor-shapes-x8.png');
  writeFileSync(file, encodePng(cv));
  console.log(`  形状对照（×${K}）：${names.join(' / ')} → ${file}`);
  return file;
}

/** 平均梯度能量（越大越"脆"、越小越"糊"；只用来给两种缩放做法一个数）。 */
function sharpness(img) {
  let sum = 0;
  let n = 0;
  for (let y = 1; y < img.height - 1; y += 1) {
    for (let x = 1; x < img.width - 1; x += 1) {
      const i = (y * img.width + x) * 4;
      const l = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
      const r = img.data[i + 4] * 0.299 + img.data[i + 5] * 0.587 + img.data[i + 6] * 0.114;
      const d = img.data[i + img.width * 4] * 0.299 + img.data[i + img.width * 4 + 1] * 0.587 + img.data[i + img.width * 4 + 2] * 0.114;
      sum += Math.abs(r - l) + Math.abs(d - l);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * 「2× 截图缩回 1×」的两种做法对比：**最近邻**（现在 `ctx.imageSmoothingEnabled=false` 的行为）
 * vs **区域平均**（`boxDownsample`，= `Image.BOX`）。
 *
 * 这不是 T5 的判据，但它决定**左格里的字清不清楚**（§1.3 的"贴图"那条），
 * 而"差一点点"这种事必须拿图说话。
 * @param {import('../compose/shots.js').ShotSource} src
 */
async function dsfCompare(src) {
  const n = 700;
  const shot = await src.load(n, 'dsh');
  const wantW = LEFT_W;
  const k = shot.width / wantW;
  if (!Number.isInteger(k)) {
    console.log(`  ⚠️ 截图 ${shot.width} 不是左格 ${wantW} 的整数倍（${k}）—— 跳过对比`);
    return;
  }
  const region = { x: 231, y: 974, w: 689, h: 98 }; // 输入框那一块：字最密
  const G = 4;

  // (a) 最近邻：走真实的 applySubjectLayer 那条路（imageSmoothingEnabled = false）
  const nearest = createLayer(wantW, H);
  blitRect(nearest, shot, 0, 0, shot.width, shot.height, 0, 0, wantW, H, { smooth: false });
  // (b) 区域平均
  const boxed = createLayer(wantW, H);
  writeRawTo(boxed, boxDownsample(readRaw(shot), wantW, H));

  /** @param {any} cv @param {string} name */
  const dump = (cv, name) => {
    const tile = createLayer(region.w, region.h);
    blitRect(tile, cv, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h, { smooth: false });
    const z = zoom(tile, G);
    const file = join(resolvePath(OUT), `dsf-${name}.png`);
    writeFileSync(file, encodePng(z));
    const crop = readRaw(tile);
    console.log(`  ${name.padEnd(8)} 平均梯度 ${sharpness(crop).toFixed(2)}  → ${file}`);
    return file;
  };
  console.log(`2× 截图缩回 ${wantW}：最近邻 vs 区域平均（输入框那一块 ×${G}）`);
  dump(nearest, 'nearest');
  dump(boxed, 'box');
  console.log(`  ⚠️ 现在成片走的是**最近邻**（ctx2d 默认 imageSmoothingEnabled=false）—— 见报告。`);
}

/**
 * 「字逐字出现又退掉」的证据条：把**输入框文字区**那一条从若干帧的截图里裁出来摞成一列。
 *
 * ⚠️ 故意用**浏览器截图（2×）**而不是合成图：这一段要人眼判的是
 * **"必须读得出来（1 秒左右）"**（D3 的内容规定），而合成路径会把 2× 缩回 1×
 * （现在是最近邻，见 `--dsf-compare`）—— 拿合成图判"读不读得出"会冤枉它。
 * @param {import('../compose/shots.js').ShotSource} src
 * @param {number[]} frames
 * @param {number} dpr
 * @returns {?string} 落盘路径（有缺帧时返回 null 并打印提示）
 */
async function typingStrip(src, frames, dpr) {
  const { ANCHORS, CONTROLS } = await import('../engine/layout.js');
  const inp = CONTROLS['composer.input'];
  const pad = 12;
  const x = Math.round((inp.x - pad) * dpr);
  const y = Math.round((inp.y - pad) * dpr);
  const w = Math.round((inp.w + 2 * pad) * dpr);
  const h = Math.round((inp.h + 2 * pad) * dpr);
  const missing = frames.filter((n) => !src.has(n, 'dsh'));
  if (missing.length) {
    console.log(`  ⚠️ 缺 ${missing.length} 帧截图（如 ${missing[0]}），跳过出现/退格证据条`);
    return null;
  }
  const cv = createLayer(w, h * frames.length);
  for (const [i, n] of frames.entries()) {
    const shot = await src.load(n, 'dsh');
    blitRect(cv, shot, x, y, w, h, 0, i * h, w, h, { smooth: false });
  }
  const file = join(resolvePath(OUT), 'composer-typing.png');
  writeFileSync(file, encodePng(cv));
  console.log(`  输入框逐字出现又退掉（${frames.length} 帧 @dpr${dpr}，每行 = 一帧）：${file}`);
  void ANCHORS;
  return file;
}

async function main() {
  mkdirSync(resolvePath(OUT), { recursive: true });

  if (ONLY_SHAPES) {
    shapesSheet();
    return 0;
  }

  if (!existsSync(resolvePath(SHOTS))) {
    console.error(`缺截图目录 ${SHOTS} —— 先跑：node film/pages/shot.mjs --track dsh --range ${RANGE[0]} ${RANGE[1]} --out ${SHOTS}`);
    return 1;
  }
  const src = openShotSource(resolvePath(SHOTS));
  const frames = RANGE_MODE ? Array.from({ length: RANGE[1] - RANGE[0] + 1 }, (_, i) => RANGE[0] + i) : FRAMES;
  // 缺帧要让 shots.js 报错（它会指出帧号）—— 不要静默跳过
  for (const n of frames) {
    if (!src.has(n, 'dsh')) {
      console.error(`缺截图：帧 ${n} → ${src.pathFor(n, 'dsh')}\n  先跑：node film/pages/shot.mjs --track dsh --range ${RANGE[0]} ${RANGE[1]} --out ${SHOTS}`);
      return 1;
    }
  }

  const trackLayers = makeTrackLayerFn({
    src,
    tracks: [{ track: 'dsh', rect: { dx: 0, dy: 0, dw: LEFT_W, dh: H } }],
    dpr: DPR,
  });

  console.log('── T5 验收图（真合成路径：frameAsync + track-layer）────────');
  console.log(`画布 ${W}×${H} · 左格 ${LEFT_W} · 截图 ${SHOTS}/ @dpr${DPR} · ${frames.length} 帧${RANGE_MODE ? '（整段）' : ''}`);

  const problems = [];
  for (const n of frames) {
    const cv = await frameAsync(n, null, { trackLayers });
    const c = cursorAt(n);
    // 整段模式写 `<帧号5位>.png`（`film/pages/preview.mjs` 认这个命名，能直接出全览表与预览片）
    const file = RANGE_MODE
      ? join(resolvePath(OUT), `${String(n).padStart(5, '0')}.png`)
      : join(resolvePath(OUT), `composite-${String(n).padStart(5, '0')}.png`);
    writeFileSync(file, encodePng(cv));

    if (!RANGE_MODE) {
      // 光标特写 ×4（以她为中心，240×180 那块）
      const half = { w: 120, h: 90 };
      const zoomFile = join(resolvePath(OUT), `cursor-${String(n).padStart(5, '0')}.png`);
      if (c.visible) {
        const tile = createLayer(half.w * 2, half.h * 2);
        blitRect(tile, cv, Math.round(c.x) - half.w, Math.round(c.y) - half.h, half.w * 2, half.h * 2, 0, 0, half.w * 2, half.h * 2, { smooth: false });
        writeFileSync(zoomFile, encodePng(zoom(tile, 4)));
      }

      // memory 面板 1:1
      const memFile = join(resolvePath(OUT), `memory-${String(n).padStart(5, '0')}.png`);
      const mem = createLayer(CELLS.memory.w, CELLS.memory.h);
      blitRect(mem, cv, CELLS.memory.x, CELLS.memory.y, CELLS.memory.w, CELLS.memory.h, 0, 0, CELLS.memory.w, CELLS.memory.h, { smooth: false });
      writeFileSync(memFile, encodePng(mem));
    }

    const rows = memoryRowsAt(n).length;
    if (!RANGE_MODE || n === frames[0] || n === frames[frames.length - 1] || n % 50 === 0) {
      console.log(
        `  帧 ${String(n).padStart(4)}  她 ${c.visible ? `${c.shape.padEnd(6)} (${c.x.toFixed(1)}, ${c.y.toFixed(1)})` : '（不在）'}` +
          `  memory ${rows} 行${RANGE_MODE ? '' : '  → composite / cursor / memory'}`,
      );
    }
    if (!c.visible && n >= 419) problems.push(`帧 ${n} 她不在画面上`);
  }
  if (RANGE_MODE) {
    console.log(`\n整段已导出到 ${OUT}/（${frames.length} 帧，命名 <帧号5位>.png）`);
    console.log(`  全览表 / 预览片：node film/pages/preview.mjs --range ${frames[0]} ${frames[frames.length - 1]} --shots ${OUT} --cols 8 --cell 480`);
  }

  // memory 的两行必须真的画出来（像素判据，不只看数据）
  for (const [n, rows] of [
    [585, 0],
    [600, 1],
    [700, 2],
  ]) {
    const stack = makeStack(n, W, H);
    const got = drawMemory({ n, t: n / FPS, stack, prev: null, postCfg: {} }).rows;
    if (got !== rows) problems.push(`帧 ${n} 的 memory 行数 ${got} ≠ 期望 ${rows}`);
  }

  shapesSheet();
  await typingStrip(src, TYPING_FRAMES, DPR);
  if (DSF_COMPARE) await dsfCompare(src);

  console.log('');
  console.log(`明细：${OUT}/composite-*.png（整幅）· ${OUT}/cursor-*.png（她 ×4）· ${OUT}/memory-*.png（那一格 1:1）`);
  console.log(`人眼要看的四件事：① 输入框里的中文字逐字出现又退掉；② 她在框里是 I-beam、出来后是箭头；`);
  console.log(`                    ③ 帧 586 / 642 之后 memory 那一格多出两行；④ 她压在两格与左格截图**之上**。`);
  if (problems.length) {
    for (const p of problems) console.log(`  ❌ ${p}`);
    return 1;
  }
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 探针失败：${/** @type {Error} */ (e).message}`);
    if (process.env.DSH_DEBUG) console.error(e.stack);
    return 1;
  }),
);
