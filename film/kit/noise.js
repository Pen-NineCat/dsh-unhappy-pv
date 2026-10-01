/**
 * film/kit/noise.js — 按帧播种的确定性噪声（**禁止 `Math.random()`**，`AGENTS.md` §2 规则 7）。
 *
 * 规则：任何随机都必须能由 `(seed, n)` 复算出来。
 * 验收：全仓（排除 `film/vendor/`）`Math.random` 为空 —— 见施工说明 §6.0 记录 4。
 *
 * 为什么不用 `Math.random`：每一帧都必须是 `t` 的**纯函数**。
 * 一旦有隐藏的全局随机源，同一帧渲两次就会不同，⭐「同帧双渲比对」直接失效，
 * 而并行分段渲染（每个 worker 从自己的 `n0` 起跑）也就不可复现了。
 */

import { createCanvas } from '@napi-rs/canvas';

import { BoundedCache } from './canvas.js';

/**
 * mulberry32 —— 小型确定性 PRNG。
 *
 * 选它的理由：状态只有一个 32 位整数、位运算少、在 V8 里快，
 * 而且是**跨平台确定**的（只用 `Math.imul` / `>>>` 这些整数运算，不碰浮点库函数）。
 * @param {number} seed
 * @returns {() => number} 返回 `[0, 1)` 的生成器
 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 按帧播种的 PRNG —— 帧级随机的**唯一**入口（施工说明 §5.5）。
 *
 * `n` 会先规范化成安全整数：`n = Math.round(t * FPS)` 是唯一主键（`AGENTS.md` §2 规则 5）。
 * @param {number} seed 稳定的种子常量（同一个视觉元素每次都用同一个数）
 * @param {number} n 帧号
 * @returns {() => number}
 */
export function frameRng(seed, n) {
  const key = ((seed >>> 0) * 9973 + Math.round(n)) >>> 0;
  return rng(key);
}

/**
 * 从生成器里取一个 `[lo, hi)` 的浮点。
 * @param {() => number} g
 * @param {number} lo @param {number} hi
 * @returns {number}
 */
export function range(g, lo, hi) {
  return lo + (hi - lo) * g();
}

/**
 * 从生成器里取一个 `[lo, hi]` 的整数。
 * @param {() => number} g @param {number} lo @param {number} hi
 * @returns {number}
 */
export function randInt(g, lo, hi) {
  return lo + Math.floor(g() * (hi - lo + 1));
}

/**
 * 从生成器里取一个数组元素（确定性挑字符、挑颜色用）。
 * @template T @param {() => number} g @param {readonly T[]} arr
 * @returns {T}
 */
export function pick(g, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(g() * arr.length))];
}

/**
 * 噪声瓦片缓存。
 *
 * **必须设容量**：瓦片的键里有 `n`，键空间随帧数无界增长（4741 帧 × 好几种瓦片）。
 * 用 `BoundedCache` 而不是普通 `Map`（施工说明附录 A 末：JS 的 `Map` 没有自动淘汰）。
 * @type {BoundedCache}
 */
export const tileCache = new BoundedCache(64);

/**
 * 生成一张**按帧播种**的灰度噪声瓦片（对应 `Image.effect_noise`）。
 *
 * 语义：`Image.effect_noise(size, sigma)` 生成以 128 为均值、`sigma` 为标准差的高斯噪声。
 * 这里用**均匀分布近似**（`128 + (g()-0.5)*2*sigma*sqrt(3)`，均匀分布的 std 就是 `sigma*sqrt(3)/...`），
 * 差别只在高阶矩；若某一段对噪声分布敏感，再换成 Box–Muller（也是确定性的）。
 * @param {number} w @param {number} h
 * @param {number} sigma 标准差（典型 8–24）
 * @param {number} seed @param {number} n
 * @returns {import('@napi-rs/canvas').Canvas} 灰度瓦片（RGB 三通道相同，alpha 满）
 */
export function noiseTile(w, h, sigma, seed, n) {
  const key = `${w}x${h}|${sigma}|${seed}|${Math.round(n)}`;
  return tileCache.get(key, () => {
    const g = frameRng(seed, n);
    const cv = createCanvas(w, h);
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(w, h);
    // 均匀分布 U(128-a, 128+a) 的 std = a/sqrt(3)，要 std = sigma 就取 a = sigma*sqrt(3)
    const a = sigma * Math.sqrt(3);
    for (let i = 0; i < id.data.length; i += 4) {
      let v = Math.round(128 + (g() * 2 - 1) * a);
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      id.data[i] = v;
      id.data[i + 1] = v;
      id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  });
}

/**
 * 整数哈希噪声（不需要画布、纯函数、无缓存）—— 给「每个格子一个稳定随机值」这类用法。
 *
 * 同 `(x, y, seed, n)` 永远得到同一个 `[0,1)` 值，且与调用顺序无关。
 * @param {number} x @param {number} y @param {number} seed @param {number} n
 * @returns {number} `[0, 1)`
 */
export function hashNoise(x, y, seed, n) {
  let h = (Math.round(x) * 374761393 + Math.round(y) * 668265263 + (seed >>> 0) * 1274126177 + Math.round(n) * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 值噪声（几个八度叠起来就是 fbm）—— 给「层堆叠背景」这类氛围用。
 * @param {number} x @param {number} y @param {number} seed @param {number} n
 * @returns {number} `[0, 1)`
 */
export function valueNoise(x, y, seed, n) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hashNoise(x0, y0, seed, n);
  const n10 = hashNoise(x0 + 1, y0, seed, n);
  const n01 = hashNoise(x0, y0 + 1, seed, n);
  const n11 = hashNoise(x0 + 1, y0 + 1, seed, n);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

/**
 * 分形叠加（fractal Brownian motion）。
 * @param {number} x @param {number} y @param {number} seed @param {number} n
 * @param {{octaves?: number, lacunarity?: number, gain?: number}} [opts]
 * @returns {number} `[0, 1)` 附近
 */
export function fbm(x, y, seed, n, opts = {}) {
  const octaves = opts.octaves ?? 4;
  const lac = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 1013, n) * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/**
 * 生成一个「按帧播种」的 ASCII/字形字符流（转场里的解码字符用它）。
 * @param {() => number} g @param {number} count @param {string} [alphabet]
 * @returns {string}
 */
export function randomGlyphs(g, count, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-<>[]{}') {
  let s = '';
  for (let i = 0; i < count; i++) s += alphabet[Math.min(alphabet.length - 1, Math.floor(g() * alphabet.length))];
  return s;
}
