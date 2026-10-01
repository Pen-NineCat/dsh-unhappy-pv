/**
 * film/compose/overlay.js — 把网页截图当**第 4 层（角色层）**接进画面（Phase 6）。
 *
 * 这是本次从零重写相对参考项目的**主要改进**（施工说明 §6 Phase 6 第 1 条）：
 * 参考项目用 `kit.her_layer = ...` 在内存里替换宿主函数（因为它只能改一个已经写死的引擎）。
 * 我们**用显式接口**：
 *
 * ```js
 * makeSubjectLayer({ n, track, src, rect, ... }) -> Canvas   // 纯函数、无副作用
 * applySubjectLayer(dst, { n, track, camera, alpha, ... })    // 把层贴进目标画布
 * ```
 *
 * 没有全局注册表、没有对 `kit` 的属性赋值、没有 `inspect.getsource` 式的源码改写
 * （§9 禁止清单第 7 条）。
 *
 * 三条实现纪律：
 * - **截图尺寸 = 目标矩形尺寸，1:1 贴入**（施工说明第 2 条）——
 *   要缩放就整层走 `camera` 变换，**不要**用 `drawImage` 的 9 参重载去缩截图（那会重采样文字）。
 *   所以 `makeSubjectLayer` 会**断言**这件事，尺寸不符直接抛。
 * - **透明边缘**（第 3 条）：截图要带 alpha（`omitBackground`），拖进画布时不铺底。
 * - **缺帧要报错**（第 5 条）：交给 `shots.js`，这里不 catch、不兜底。
 */

import { createLayer, ctx2d } from '../kit/canvas.js';
import { applyTransform, normalizeTransform } from '../engine/camera.js';
import { NON_LEAD_ALPHA, leadAlphaAt } from './lead.js';

/**
 * @typedef {Object} Rect
 * @property {number} dx 目标左上角 x @property {number} dy 目标左上角 y
 * @property {number} dw 目标宽 @property {number} dh 目标高
 */

/**
 * 把一张截图包成「角色层」：**独立画布**，尺寸就是目标矩形
 * （`AGENTS.md` §7：第 4 层必须是独立画布，否则推拉/滑出/隔离都做不了）。
 *
 * @param {{n: number, track: string, src: import('./shots.js').ShotSource,
 *          rect: Rect, dpr?: number}} spec
 *   `rect` 是**目标矩形**（CSS px）；`dpr` 是截图的 deviceScaleFactor。
 *   两者合起来决定「截图该是多少像素」—— 这就是 1:1 的判据。
 * @returns {Promise<import('@napi-rs/canvas').Canvas>}
 */
export async function makeSubjectLayer(spec) {
  const { n, track, src, rect, dpr = 2 } = spec;
  if (!rect) throw new Error('makeSubjectLayer: 缺 rect（目标矩形）');
  for (const k of ['dx', 'dy', 'dw', 'dh']) {
    if (!Number.isFinite(/** @type {any} */ (rect)[k])) {
      throw new Error(`makeSubjectLayer: rect.${k} 不是有限数（${/** @type {any} */ (rect)[k]}）`);
    }
  }
  const shot = await src.load(n, track);

  // 1:1 的判据：截图像素尺寸 == 目标矩形 × dpr
  const wantW = Math.round(rect.dw * dpr);
  const wantH = Math.round(rect.dh * dpr);
  if (shot.width !== wantW || shot.height !== wantH) {
    throw new Error(
      `角色层的截图尺寸与目标矩形不是 1:1：\n` +
        `  截图 ${shot.width}×${shot.height}，目标矩形 ${rect.dw}×${rect.dh} @dpr${dpr} → 期望 ${wantW}×${wantH}\n` +
        `  hint: 截图尺寸必须等于目标矩形（施工说明 §6 Phase 6 第 2 条）。\n` +
        `        要缩放请整层走 camera 变换，不要用 drawImage 缩截图（文字会被重采样）`,
    );
  }

  const layer = createLayer(shot.width, shot.height);
  const ctx = ctx2d(layer);
  ctx.drawImage(shot, 0, 0); // 1:1，无缩放
  return layer;
}

/**
 * 把角色层贴进目标画布，并施加**镜头变换**与**主导权 alpha**。
 *
 * `dst` 上这一块先被清空（`clearRect`）—— 否则角色层下面的东西会透出来，
 * 而角色层本身是带透明边缘的（第 3 条）。
 *
 * @param {any} dst 目标画布（通常是 `stack.subject`），尺寸 = 整个画面
 * @param {{layer: any, rect: Rect, camera?: Partial<import('../engine/camera.js').CameraTransform>,
 *          alpha?: number, clear?: boolean, dpr?: number}} spec
 * @returns {{drawn: boolean, alpha: number, transform: import('../engine/camera.js').CameraTransform}}
 */
export function applySubjectLayer(dst, spec) {
  const { layer, rect } = spec;
  const dpr = spec.dpr ?? 2;
  const ctx = ctx2d(dst);
  const t = normalizeTransform(spec.camera ?? {});
  const alpha = spec.alpha ?? 1;

  if (spec.clear ?? true) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  if (alpha <= 0) {
    return { drawn: false, alpha, transform: t };
  }

  ctx.save();
  applyTransform(ctx, t, rect);
  ctx.globalAlpha = alpha;
  // 截图像素 → CSS px：按 dpr 画回目标矩形的尺寸（仍然是 1:1 的整数关系，不是「凑」出来的缩放）
  ctx.drawImage(layer, rect.dx, rect.dy, rect.dw, rect.dh);
  ctx.globalAlpha = 1;
  ctx.restore();
  void dpr;
  return { drawn: true, alpha, transform: t };
}

/**
 * 把「取层 + 贴层」合成一步（`frame()` 里最常用的那个）。
 *
 * 主导权 alpha 由 `lead.js` 决定，**不在这里判**（职责分开：表在 lead.js，画在 overlay.js）。
 * @param {any} dst
 * @param {{n: number, track: string, src: import('./shots.js').ShotSource, rect: Rect,
 *          camera?: Partial<import('../engine/camera.js').CameraTransform>,
 *          alpha?: number, dpr?: number, useLead?: boolean}} spec
 * @returns {Promise<{drawn: boolean, alpha: number}>}
 */
export async function overlayShot(dst, spec) {
  const alpha = spec.alpha ?? (spec.useLead === false ? 1 : leadAlphaAt(spec.n, /** @type {any} */ (spec.track)));
  const layer = await makeSubjectLayer(spec);
  const r = applySubjectLayer(dst, {
    layer,
    rect: spec.rect,
    camera: spec.camera,
    alpha,
    dpr: spec.dpr,
  });
  return { drawn: r.drawn, alpha: r.alpha };
}

/**
 * 一次贴**多条轨道**（左/右两块，施工说明 §5.2 的左右分屏预留）。
 *
 * 按 alpha 升序画：alpha 小的先画，大的盖在上面 —— 否则「主角在上面」这件事
 * 会变成由数组顺序决定，而不是由主导权决定。
 * @param {any} dst
 * @param {{n: number, src: import('./shots.js').ShotSource,
 *          tracks: {track: string, rect: Rect, camera?: any}[],
 *          dpr?: number, alphas?: Record<string, number>}} spec
 * @returns {Promise<{drawn: string[], skipped: string[]}>}
 */
export async function overlayTracks(dst, spec) {
  const withAlpha = spec.tracks.map((t) => ({
    ...t,
    alpha: spec.alphas?.[t.track] ?? leadAlphaAt(spec.n, /** @type {any} */ (t.track)),
  }));
  withAlpha.sort((a, b) => a.alpha - b.alpha);

  const drawn = [];
  const skipped = [];
  // 清一次就够（applySubjectLayer 默认会清，多条轨道时只能清第一次）
  let first = true;
  for (const t of withAlpha) {
    if (t.alpha <= 0) {
      skipped.push(t.track);
      continue;
    }
    const layer = await makeSubjectLayer({ ...spec, ...t, n: spec.n, track: t.track });
    applySubjectLayer(dst, { layer, rect: t.rect, camera: t.camera, alpha: t.alpha, clear: first, dpr: spec.dpr });
    first = false;
    drawn.push(t.track);
  }
  if (first) {
    // 一条都没画：仍然清一次，免得残留上一帧
    ctx2d(dst).clearRect(0, 0, dst.width ?? ctx2d(dst).canvas.width, dst.height ?? ctx2d(dst).canvas.height);
  }
  return { drawn, skipped };
}

export { NON_LEAD_ALPHA };
