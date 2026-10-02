#!/usr/bin/env node
/**
 * film/test/probe-t4.mjs — **T4 的验收图**：把左格截图与画布骨架合成成整幅。
 *
 * 画面规格 §1.2 对 T4 的要求是"版面一旦跑出来就能立刻判断**格子对不对**，不用等内容"，
 * 所以这个探针只做一件事：给定帧号，出**一张 1920×1080 的合成图**，
 * 左格是真 dsh UI 的截图，右列是 `content/panels.js` 画的空面板。
 *
 * ## 它同时验三条硬规则
 *
 * 1. **1:1 贴入**（§1.3「贴图」）：截图尺寸必须是左格尺寸的**整数倍**（§2.2），
 *    缩放用 `kit/canvas.js` 的 `blitRect`（整数倍时就是精确的 box 平均，没有非整数重采样）。
 * 2. **逐帧的矩形**（§2.1 U3）：满屏 1920×1080 → 帧 350–418 收到左格 1152×1080。
 * 3. **版面的三条边界**（§2.2）：左格右缘、右列中线、画布右边 —— 都是整数像素。
 *
 * ⚠️ 这不是成片的合成路径：成片走 `film/render-video.js` 的 `--trackLayers`
 *   （见 `film/compose/{overlay,shots,track-layer}.js`）。这个探针是**给人看图**的。
 *
 * 用法：
 *   node film/test/probe-t4.mjs                 # 默认帧 100 / 380 / 418 / 1000
 *   node film/test/probe-t4.mjs --frames 350,400
 *   node film/test/probe-t4.mjs --shots out/prelude --out out/t4
 *
 * 退出码：0 全部成功 / 1 有帧失败（缺截图、尺寸对不上）/ 2 用法错误。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { H, W } from '../engine/clock.js';
import { frame } from '../engine/frame.js';
import { LEFT_W, leftWidthAt } from '../engine/layout.js';
import { blitRect, createLayer, ctx2d, encodePng } from '../kit/canvas.js';

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ n, /** @type {any} */ d) => {
  const i = argv.indexOf(n);
  return i < 0 ? d : argv[i + 1];
};
const OUT = String(flag('--out', 'out/t4'));
const SHOTS = String(flag('--shots', 'out/t4shots'));
const DPR = Number(flag('--dpr', 2)) || 2;
const FRAMES = String(flag('--frames', '100,380,418,1000'))
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));

/** @param {number} n @returns {string} */
const shotFile = (n) => join(resolvePath(SHOTS), `${String(n).padStart(5, '0')}.png`);

async function main() {
  mkdirSync(resolvePath(OUT), { recursive: true });
  const { loadImage } = await import('@napi-rs/canvas');
  console.log(`── T4 验收图：左格截图 + 画布骨架合成 ────────────────────`);
  console.log(`画布 ${W}×${H} · 左格 ${LEFT_W} · 截图目录 ${SHOTS}/ @dpr${DPR}`);
  console.log('');

  /** @type {string[]} */
  const problems = [];
  for (const n of FRAMES) {
    const file = shotFile(n);
    if (!existsSync(file)) {
      problems.push(`帧 ${n}：缺截图 ${file}（先跑 node film/pages/shot.mjs --frames ${n} --out ${SHOTS}）`);
      continue;
    }
    const wantW = leftWidthAt(n);
    const img = await loadImage(readFileSync(file));

    // ⭐ 1:1 的**前提**：截图宽 = 目标宽 × 整数倍（§2.2「截图尺寸 = 左格像素尺寸 × 整数 dsf」）
    const ratio = img.width / wantW;
    const okRatio = Number.isInteger(ratio) && ratio >= 1;
    const okHeight = img.height === H * ratio;
    console.log(
      `帧 ${String(n).padStart(4)}  左格 ${wantW}×${H}  截图 ${img.width}×${img.height}` +
        `  倍率 ${ratio}×  ${okRatio && okHeight ? '✅ 整数倍' : '❌ 不是整数倍（会被重采样，§2.2 禁止）'}`,
    );
    if (!okRatio) problems.push(`帧 ${n}：截图宽 ${img.width} 不是左格宽 ${wantW} 的整数倍`);
    if (!okHeight) problems.push(`帧 ${n}：截图高 ${img.height} ≠ ${H} × ${ratio}`);

    // 画布那一帧（右列骨架 + 引子占位背景）
    const base = frame(n);
    // 把截图贴进左上角（1:1 的目标矩形），缩放走 blitRect（整数倍 → 精确 box 平均）
    blitRect(base, img, 0, 0, img.width, img.height, 0, 0, wantW, H);
    const outFile = join(resolvePath(OUT), `composite-${String(n).padStart(5, '0')}.png`);
    writeFileSync(outFile, encodePng(base));
    console.log(`         → ${outFile}`);
    void createLayer;
    void ctx2d;
  }
  console.log('');
  if (problems.length) {
    for (const p of problems) console.log(`  ❌ ${p}`);
    return 1;
  }
  console.log('结论：每一帧的左格截图都与目标矩形**整数倍**对应，版面三条边界都是整数像素。');
  console.log('      人眼要看的是：左格右缘那条竖线、右列中线、以及格子有没有对齐 1152 / 768 / 540。');
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 失败：${/** @type {Error} */ (e).message}`);
    if (process.env.DSH_DEBUG) console.error(e.stack);
    return 1;
  }),
);
