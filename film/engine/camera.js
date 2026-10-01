/**
 * film/engine/camera.js — 镜头运动：**统一作用在角色层上**的画布变换。
 *
 * 为什么单独一个文件（设计文档里的待办 #3：「把网页截图当成图形侧的一个图层，统一做镜头运动」）：
 * 镜头运动是「谁被推拉/滑出/隔离」这件事的唯一入口。它必须是**纯函数**：
 * `(n) → {scale, tx, ty, rot, anchor}`，这样同一帧渲两次一定一样。
 *
 * 与 `film/engine/layers.js` 的分工：
 * - `layers.js` 管**层序**（谁盖谁）
 * - `camera.js` 管**变换**（每一层被怎么动）
 * - 第 4 层（`subject`）必须是独立画布，就是为了让这里的变换能只作用在它上面
 *   （`AGENTS.md` §7；否则推拉/滑出/隔离都做不了）
 *
 * 坐标系约定（写清楚，免得各自理解不同）：
 * - `dst` = 目标画布上那个**矩形**（左上角 `dx,dy`，尺寸 `dw×dh`）
 * - `tx/ty` 是**目标像素**的平移；`scale` 围绕 `anchor` 缩放
 * - `anchor` 是 0..1 的**归一化锚点**（`0.5,0.5` = 矩形的中心）
 */

/**
 * @typedef {Object} CameraTransform
 * @property {number} scale 缩放（1 = 原始大小）
 * @property {number} tx 目标像素平移 x
 * @property {number} ty 目标像素平移 y
 * @property {number} rot 旋转（弧度）
 * @property {[number, number]} anchor 归一化锚点（0..1）
 */

/** 恒等变换（不动）。 @type {CameraTransform} */
export const IDENTITY = Object.freeze({ scale: 1, tx: 0, ty: 0, rot: 0, anchor: /** @type {[number,number]} */ ([0.5, 0.5]) });

/**
 * 补全/校验一个变换。
 * @param {Partial<CameraTransform>} [t]
 * @returns {CameraTransform}
 */
export function normalizeTransform(t = {}) {
  const out = {
    scale: t.scale ?? 1,
    tx: t.tx ?? 0,
    ty: t.ty ?? 0,
    rot: t.rot ?? 0,
    anchor: t.anchor ?? /** @type {[number,number]} */ ([0.5, 0.5]),
  };
  if (!(out.scale > 0)) {
    throw new Error(
      `camera: scale 必须为正（收到 ${out.scale}）\n` +
        `  hint: scale=0 会把整层画没；要做「缩到看不见」请用 alpha 或把它移出画布`,
    );
  }
  if (!Array.isArray(out.anchor) || out.anchor.length !== 2) {
    throw new Error(`camera: anchor 必须是 [x, y]（0..1），收到 ${JSON.stringify(out.anchor)}`);
  }
  return out;
}

/**
 * 定一个静态变换（用于测试与「这段镜头不动」的段落）。
 * @param {Partial<CameraTransform>} t
 * @returns {CameraTransform}
 */
export function createStaticTransform(t) {
  return normalizeTransform(t);
}

/**
 * 把变换写成一行可读文本（日志/对拍用）。
 * @param {CameraTransform} t
 * @returns {string}
 */
export function describeTransform(t) {
  return `scale=${t.scale.toFixed(3)} t=(${t.tx.toFixed(1)},${t.ty.toFixed(1)}) rot=${((t.rot * 180) / Math.PI).toFixed(2)}° anchor=(${t.anchor[0]},${t.anchor[1]})`;
}

/**
 * 线性插值两个变换（做「镜头缓慢推移」时用）。
 *
 * 锚点也插值 —— 不然围绕不同锚点的两个关键帧之间会有跳动。
 * @param {CameraTransform} a @param {CameraTransform} b @param {number} k 0..1
 * @returns {CameraTransform}
 */
export function lerpTransform(a, b, k) {
  const t = Math.max(0, Math.min(1, k));
  return normalizeTransform({
    scale: a.scale + (b.scale - a.scale) * t,
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
    rot: a.rot + (b.rot - a.rot) * t,
    anchor: [
      a.anchor[0] + (b.anchor[0] - a.anchor[0]) * t,
      a.anchor[1] + (b.anchor[1] - a.anchor[1]) * t,
    ],
  });
}

/**
 * 由关键帧表建一个 `(n) → CameraTransform` 的**纯函数**。
 *
 * 表形如 `[[n0, tf0], [n1, tf1], ...]`（按 `n` 升序），首尾之外**钳制**到端点
 * （不外推：外推会让「镜头一直飞」，是逐帧动画里的经典事故）。
 * @param {Array<[number, Partial<CameraTransform>]>} keys
 * @returns {(n: number) => CameraTransform}
 */
export function keyframed(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('camera.keyframed: 至少要一个关键帧');
  }
  const sorted = [...keys].sort((a, b) => a[0] - b[0]).map(([n, t]) => [n, normalizeTransform(t)]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] === sorted[i - 1][0]) {
      throw new Error(`camera.keyframed: 第 ${i} 个关键帧与上一个帧号相同（${sorted[i][0]}）`);
    }
  }
  return (n) => {
    if (n <= sorted[0][0]) return sorted[0][1];
    const last = sorted[sorted.length - 1];
    if (n >= last[0]) return last[1];
    for (let i = 1; i < sorted.length; i++) {
      const [n1, t1] = sorted[i];
      if (n <= n1) {
        const [n0, t0] = sorted[i - 1];
        return lerpTransform(t0, t1, (n - n0) / (n1 - n0));
      }
    }
    return last[1]; // 不可达，保险
  };
}

/**
 * 沿一条正弦做「呼吸式」微动（让静止的镜头不像一张死图）。
 *
 * 幅度单位是**目标像素**；相位由 `n` 决定，所以是纯函数。
 * @param {{ampX?: number, ampY?: number, periodFrames?: number, ampScale?: number}} [opts]
 * @returns {(n: number) => CameraTransform}
 */
export function breathing(opts = {}) {
  const ampX = opts.ampX ?? 3;
  const ampY = opts.ampY ?? 2;
  const period = opts.periodFrames ?? 240; // 10 s
  const ampScale = opts.ampScale ?? 0.004;
  return (n) => {
    const ph = (2 * Math.PI * n) / period;
    return normalizeTransform({
      scale: 1 + ampScale * Math.sin(ph * 0.5),
      tx: ampX * Math.sin(ph),
      ty: ampY * Math.sin(ph * 0.7 + 1.1),
    });
  };
}

/**
 * 画一个 `CameraTransform` 到 2D context 上（**就地**改变换栈，调用方负责 save/restore）。
 *
 * 顺序是「先平移到锚点 → 缩放/旋转 → 平移到注入点 → 加目标平移」，
 * 这样 `anchor` 的语义就是「矩形里哪个点保持不动」。
 * @param {any} ctx `@napi-rs/canvas` 的 2D context
 * @param {CameraTransform} t
 * @param {{dx: number, dy: number, dw: number, dh: number}} rect 目标矩形
 */
export function applyTransform(ctx, t, rect) {
  const ax = rect.dx + rect.dw * t.anchor[0];
  const ay = rect.dy + rect.dh * t.anchor[1];
  ctx.translate(ax + t.tx, ay + t.ty);
  if (t.rot !== 0) ctx.rotate(t.rot);
  if (t.scale !== 1) ctx.scale(t.scale, t.scale);
  ctx.translate(-ax, -ay);
}
