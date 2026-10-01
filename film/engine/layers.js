/**
 * film/engine/layers.js — 固定六层顺序（`AGENTS.md` §7，施工说明 §5.2）。
 *
 * ```
 * 1. background    背景（含缓存的纹理 / 噪声瓦片）
 * 2. content       场景自身绘制
 * 3. carriers      跨镜头的载具，带 alpha，用「墨」重画，绝不用成片截图
 * 4. subject       角色层，独立 RGBA —— 推拉 / 滑出 / 隔离都作用在它上面
 * 5. chrome        装饰与 UI 框，每帧重画，永不被变换
 * 6. post          后期（残影 / 辉光 / 扫描线 / 暗角）
 * ```
 *
 * 两条硬约束：
 *
 * - **顺序写成数据，不散在调用点**（施工说明 §6 Phase 4 第 1 条）。
 *   故意把 `subject` 挪到 `content` 之前只需改这一个数组 —— 验收要求「视觉上角色被背景盖住」
 *   来证明顺序生效，那就得能一处改掉。
 * - **第 4 层必须是独立画布**。这是「合成器能对角色做镜头运动」的唯一前提，
 *   也是「把网页截图当角色」能成立的原因（`AGENTS.md` §7）。
 *
 * `post` 不在这个数组里：它需要 `prev`，是最后单独一步（见 `film/engine/frame.js`）。
 */

import { createLayer } from '../kit/canvas.js';

/**
 * 六层顺序的表。**改顺序只改这里。**
 * @type {readonly ['background', 'content', 'carriers', 'subject', 'chrome']}
 */
export const LAYERS = /** @type {const} */ (['background', 'content', 'carriers', 'subject', 'chrome']);

/**
 * 需要 alpha 的层（其余层是不透明底）。
 * `subject` 必须在这里 —— 它就是「能被单独变换的那一层」。
 * @type {ReadonlySet<string>}
 */
export const ALPHA_LAYERS = new Set(['carriers', 'subject']);

/**
 * @typedef {Object} LayerStack
 * @property {number} n 帧号
 * @property {import('@napi-rs/canvas').Canvas} background
 * @property {import('@napi-rs/canvas').Canvas} content
 * @property {import('@napi-rs/canvas').Canvas} carriers
 * @property {import('@napi-rs/canvas').Canvas} subject
 * @property {import('@napi-rs/canvas').Canvas} chrome
 */

/**
 * 建一整套图层。每帧都新建（**不做跨帧复用** —— 那会变成模块级状态，
 * 违反「每帧是 t 的纯函数」，也会让 worker 之间互相污染）。
 * @param {number} n 帧号
 * @param {number} w @param {number} h
 * @returns {LayerStack}
 */
export function makeStack(n, w, h) {
  return {
    n,
    background: createLayer(w, h),
    content: createLayer(w, h),
    carriers: createLayer(w, h),
    subject: createLayer(w, h),
    chrome: createLayer(w, h),
  };
}

/**
 * 让 `LAYERS` 这种「数据驱动」真的能跑：给一个名字，拿到那层的 canvas。
 * @param {LayerStack} stack
 * @param {'background'|'content'|'carriers'|'subject'|'chrome'} name
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function layerByName(stack, name) {
  const l = stack[name];
  if (!l) throw new Error(`layers: 没有叫 "${name}" 的层（现有：${LAYERS.join(', ')}）`);
  return l;
}

/**
 * 按 `LAYERS` 的顺序把整套图**从下到上**合到 `dst` 上。
 *
 * 用 `source-over` 逐层叠 —— PIL 侧对应 `alpha_composite`。
 * @param {import('@napi-rs/canvas').Canvas} dst
 * @param {LayerStack} stack
 * @param {{skip?: ReadonlySet<string>}} [opts] `skip` 用来临时抽掉某一层做对比（不要常态使用）
 */
export function compose(dst, stack, opts = {}) {
  const ctx = typeof dst.getContext === 'function' ? dst.getContext('2d') : dst;
  const canvas = ctx.canvas;
  const skip = opts.skip ?? new Set();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  for (const name of LAYERS) {
    if (skip.has(name)) continue;
    const layer = layerByName(stack, name);
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      throw new Error(
        `compose: 层 "${name}" 尺寸 ${layer.width}×${layer.height} 与目标 ${canvas.width}×${canvas.height} 不一致\n` +
          `  hint: 六层尺寸都必须来自 clock.js 的 W/H`,
      );
    }
    ctx.drawImage(layer, 0, 0);
  }
  return canvas;
}
