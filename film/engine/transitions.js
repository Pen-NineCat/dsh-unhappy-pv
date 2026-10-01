/**
 * film/engine/transitions.js — 逐格延迟转场（施工说明 §6 Phase 4 第 3 条，
 * 参考项目 `kit.py:348-414` 的抽象，施工说明说这是「最值得抄的」）。
 *
 * 思路：**先把「什么时候轮到这一格切换」写成一个纯函数 `delay(x, y) → 秒`**，
 * 然后一次 `reveal(old, new, t, delay)` 就能得到任意转场 ——
 * 径向、向内收、横扫、噪声溶解，全部只是换一个 `delay` 函数。
 *
 * 三个硬纪律：
 * 1. **`delay` 必须是纯函数**（`AGENTS.md` §2 规则 6/7）。随机用 `frameRng`，不用 `Math.random`。
 * 2. **mask 先在格子分辨率算完，再 `NEAREST` 放大** —— 逐像素算 `hypot` 在 1920×1080 上是纯浪费，
 *    而且格子的方块感本来就是这种转场要的质感。
 * 3. **`t` 相同时结果一致**（验收项）。所以 `reveal()` 里不许有任何隐藏状态。
 *
 * 单位统一用**秒**（与时间线、`clock.js` 一致），不要混用帧号。
 */

import { END_T, W, H } from './clock.js';

/**
 * 一个「延迟函数」：给定格坐标，返回该格**开始切换的时刻**（秒）。
 * @typedef {(x: number, y: number) => number} DelayFn
 */

/**
 * 径向：从一个（或几个）出发点向外扩散，像水波。
 *
 * `speed` 的单位是**像素/秒**：`delay = t0 + 离最近出发点的距离 / speed`。
 * 给多个种子点就会从多个中心同时扩散（波前相遇）。
 * @param {number[]} seeds 种子点坐标，形如 `[x0, y0, x1, y1, ...]`；空则从画面中心出发
 * @param {number} t0 最早的切换时刻（秒）
 * @param {number} speed 像素/秒
 * @param {{w?: number, h?: number}} [opts]
 * @returns {DelayFn}
 */
export function radial(seeds, t0, speed, opts = {}) {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const pts = seeds.length >= 2 ? seeds : [w / 2, h / 2];
  if (speed <= 0) throw new Error(`radial: speed 必须为正，收到 ${speed}`);
  return (x, y) => {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const dx = x - pts[i];
      const dy = y - pts[i + 1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return t0 + best / speed;
  };
}

/**
 * 向内收：从画面**边缘**往中心收（或反过来，用 `fromCenter`）。
 *
 * 与 `radial` 的区别：`radial` 按**到种子的距离**，`inward` 按**到最近边的距离**。
 * 所以它切开的是一个矩形环（而不是圆环），「关窗帘」的感觉。
 *
 * ⚠️ 语义细节：`delay` 在 `depth == reach` 处**被截断**，所以比 `reach` 更靠内的格子
 * 是**同时**在 `t1` 切换的（一个平台期），不是「越靠内越晚」。
 * 想要「永远越靠内越晚」就把 `reach` 给到大于画面半对角线的值；想要「到点就一起切」就用默认。
 * @param {number} t0 边缘开始切换的时刻
 * @param {number} t1 最后一批切换的时刻（`depth >= reach` 的所有格子都在这一刻）
 * @param {{reach?: number, w?: number, h?: number, fromCenter?: boolean}} [opts]
 *   `reach`：切换要推进到多深（像素），默认到中心
 * @returns {DelayFn}
 */
export function inward(t0, t1, opts = {}) {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const fromCenter = opts.fromCenter ?? false;
  const reach = opts.reach ?? Math.min(w, h) / 2;
  if (reach <= 0) throw new Error(`inward: reach 必须为正，收到 ${reach}`);
  return (x, y) => {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y); // 到最近边的距离
    const depth = fromCenter ? Math.min(w, h) / 2 - edge : edge;
    const p = Math.max(0, Math.min(1, depth / reach));
    return t0 + (t1 - t0) * p;
  };
}

/**
 * 横扫：一条直线推过去。
 * @param {[number, number]} origin 直线起点
 * @param {[number, number]} dir 行进方向（不必归一化）
 * @param {number} t0
 * @param {number} speed 像素/秒
 * @returns {DelayFn}
 */
export function sweep(origin, dir, t0, speed) {
  const len = Math.hypot(dir[0], dir[1]);
  if (len === 0) throw new Error('sweep: dir 不能是零向量');
  if (speed <= 0) throw new Error(`sweep: speed 必须为正，收到 ${speed}`);
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  return (x, y) => {
    // 只取沿方向的投影；负的（反方向那一侧）也算，否则直线两侧永远不切换
    const proj = (x - origin[0]) * ux + (y - origin[1]) * uy;
    return t0 + proj / speed;
  };
}

/**
 * 噪声溶解：`hashNoise` 决定每一格的阈值，所以是**纯度**函数（同一格永远同一个阈值），
 * 但观感上没有规则形状。适合「崩坏」那类。
 * @param {number} t0 @param {number} t1
 * @param {number} seed
 * @param {{scale?: number}} [opts] `scale` 越大格子越细
 * @returns {DelayFn}
 */
export function dissolve(t0, t1, seed, opts = {}) {
  const scale = opts.scale ?? 1;
  return (x, y) => {
    // 内联一份整数哈希（与 kit/noise.js 的 hashNoise 同样的常数，避免为了一个函数跨层 import）
    let h = (Math.round(x / scale) * 374761393 + Math.round(y / scale) * 668265263 + (seed >>> 0) * 1274126177) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    return t0 + (t1 - t0) * r;
  };
}

/**
 * 把多个 `delay` 函数取**最小**（谁先到谁切），用来叠转场。
 * @param {...DelayFn} fns
 * @returns {DelayFn}
 */
export function firstOf(...fns) {
  return (x, y) => {
    let m = Infinity;
    for (const f of fns) {
      const v = f(x, y);
      if (v < m) m = v;
    }
    return m;
  };
}

/**
 * 一个转场在时间上的**结束时刻**（用来做时间线断言 / 排布）。
 * 在格子分辨率上扫一遍，返回最大 delay。
 * @param {DelayFn} delay
 * @param {{w?: number, h?: number, cell?: number}} [opts]
 * @returns {number}
 */
export function delayEnd(delay, opts = {}) {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const cell = opts.cell ?? 16;
  let max = -Infinity;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const v = delay(x, y);
      if (v > max) max = v;
    }
  }
  return max;
}

/**
 * 断言一个转场完全落在片长之内（`AGENTS.md` §8 的时间线护栏在转场上的版本）。
 * @param {DelayFn} delay
 * @param {string} label
 * @param {{w?: number, h?: number, cell?: number}} [opts]
 * @throws {Error}
 */
export function assertWithinFilm(delay, label, opts = {}) {
  const end = delayEnd(delay, opts);
  if (!(end <= END_T)) {
    throw new Error(
      `转场 "${label}" 的最后一格在 t=${end} 才开始切换，已经超出片长 ${END_T}\n` +
        `  hint: 提高 speed、缩小 reach，或把 t0/t1 往前挪`,
    );
  }
  return end;
}
