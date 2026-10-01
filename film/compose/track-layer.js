/**
 * film/compose/track-layer.js — 把「按轨道贴截图」做成**可注册的显式接口**（Phase 6）。
 *
 * 施工说明 §6 Phase 6 第 1 条给了两种做法，这是第二种：
 *
 * ```js
 * // 或者是一个注册表：{ byTime: [[t0, t1, fn], ...] }
 * ```
 *
 * 为什么要有这一层：`film/engine/frame.js` **不许** import `film/compose/` 或 `playwright`
 * —— 否则引擎就绑死在浏览器侧了（Phase 3 的 `--no-post` 那种「关掉一层还能跑」的能力会丢）。
 * 所以引擎只认一个**函数**，函数从哪来由调用方决定：
 *
 * ```js
 * // film/render-video.js 里
 * frame(n, null, { trackLayers: makeTrackLayerFn({ src, tracks: [...] }) })
 * ```
 *
 * 这一层**没有猴补丁**：不是往 `kit` 上塞属性，而是一个显式参数。
 */

import { overlayTracks } from './overlay.js';
import { leadAlphaAt } from './lead.js';

/**
 * 建一个「贴轨道层」的函数。
 *
 * 返回的函数签名是 `(stack, { n, prev, postCfg }) => Promise<void>`，
 * 正好是 `film/engine/frame.js` 期望的形状（见 `FrameOptions.trackLayers`）。
 *
 * @param {{
 *   src: import('./shots.js').ShotSource,
 *   tracks: {track: string, rect: import('./overlay.js').Rect, camera?: any}[],
 *   dpr?: number,
 *   alphas?: (n: number, track: string) => number,
 *   onMissing?: 'throw' | 'skip',
 * }} spec
 * @returns {(stack: import('../engine/layers.js').LayerStack, ctx: {n: number}) => Promise<void>}
 */
export function makeTrackLayerFn(spec) {
  const dpr = spec.dpr ?? 2;
  if (!spec.tracks || spec.tracks.length === 0) {
    throw new Error('makeTrackLayerFn: tracks 不能为空');
  }
  const alphaOf = spec.alphas ?? ((n, track) => leadAlphaAt(n, /** @type {any} */ (track)));

  return async function trackLayers(stack, ctx) {
    const { n } = ctx;
    /** @type {Record<string, number>} */
    const alphas = {};
    for (const t of spec.tracks) alphas[t.track] = alphaOf(n, t.track);
    await overlayTracks(stack.subject, {
      n,
      src: spec.src,
      tracks: spec.tracks,
      dpr,
      alphas,
    });
  };
}

/**
 * 两条轨道 × 左右分屏的**几何**（`design-options.md` 的版图：`dsh 人形 | dsh UI | 用户人形`）。
 *
 * ⚠️ 这里的坐标是**占位**：真实版图与「她」的形象还是 🚧（`AGENTS.md` §1）。
 * 但**接口**是最终的 —— 换版图只改这个函数与 `lead.js` 的表。
 * @param {{w: number, h: number, left?: number, top?: number, size?: number}} opts
 * @returns {{dsh: import('./overlay.js').Rect, user: import('./overlay.js').Rect}}
 */
export function splitLayout(opts) {
  const w = opts.w;
  const h = opts.h;
  const size = opts.size ?? Math.round(h * 0.55);
  const top = opts.top ?? Math.round((h - size) / 2);
  const left = opts.left ?? Math.round(w * 0.04);
  return {
    // 「我」（dsh）：左边
    dsh: { dx: left, dy: top, dw: size, dh: size },
    // 「用户」：右边
    user: { dx: w - left - size, dy: top, dw: size, dh: size },
  };
}
