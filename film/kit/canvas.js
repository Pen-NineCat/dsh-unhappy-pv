/**
 * film/kit/canvas.js — 画布、图层与合成算子（PIL 的 `Image` / `ImageChops` / `ImageDraw` 等价物）。
 *
 * 纪律（`AGENTS.md` §7）
 * --------------------
 * - **alpha 只在 `getImageData` / `putImageData` 边界转换**：Canvas2D 内部预乘，
 *   `getImageData` 返回**非预乘**。本文件与 `kit/pixels.js` 是唯一的转换点，中间层一律非预乘。
 * - **`content/` 只许调 `kit/`**：所以「换个光栅后端」是一处改动，而不是全仓搜索替换。
 * - **禁止 `Math.random()`**：噪声在 `kit/noise.js` 里按帧播种。
 *
 * 与 PIL 的对应关系见施工说明附录 A。这里的每个函数都在注释里写清它对应哪个 PIL 调用，
 * 以及**保真度**（✅ 语义等价 / ⚠️ 有已知差异 / 🔴 无等价物）。
 *
 * 缓存纪律（施工说明附录 A 末）：JS 的 `Map` **没有容量上限**。
 * 本文件的缓存只有两种：键空间有限的（不清理），以及显式设上限的（见 `Cache`）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { createCanvas, loadImage } from '@napi-rs/canvas';

import { assertRgb24Buffer, assertSize, rawRGB, rawRGBA } from './pixels.js';

export { createCanvas, loadImage };

/**
 * 小型有界缓存（替代 Python 的 `lru_cache`，但**必须显式设容量** —— JS 的 Map 不会自己淘汰）。
 *
 * 用法上只对「键空间可能无限」的东西用它（比如按 `(seed, n)` 生成的噪声瓦片）；
 * 字体、字形图集、暗角这种键空间有限的，直接用普通 Map 就好。
 */
export class BoundedCache {
  /**
   * @param {number} capacity 最多存多少项（超过就淘汰最早的）
   */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('BoundedCache 容量必须是正整数');
    this.capacity = capacity;
    /** @type {Map<any, any>} */
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {any} key
   * @param {() => any} build
   * @returns {any}
   */
  get(key, build) {
    if (this.map.has(key)) {
      this.hits++;
      return this.map.get(key);
    }
    this.misses++;
    const v = build();
    this.map.set(key, v);
    if (this.map.size > this.capacity) {
      // Map 保持插入顺序，删第一个就是最老的
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    return v;
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/**
 * 建一张**带 alpha** 的图层（对应 `Image.new('RGBA', ...)`）。
 * @param {number} w
 * @param {number} h
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function createLayer(w, h) {
  return createCanvas(w, h);
}

/**
 * 建一张**不透明底色**的图（对应 `Image.new('RGB', size, color)`）。
 * @param {number} w
 * @param {number} h
 * @param {string|number[]} rgb CSS 颜色串（`'#101418'`）或 `[r,g,b]`
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function createOpaque(w, h, rgb = '#000000') {
  const cv = createCanvas(w, h);
  const ctx = ctx2d(cv);
  ctx.fillStyle = Array.isArray(rgb) ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : rgb;
  ctx.fillRect(0, 0, w, h);
  return cv;
}

/**
 * 取 2D context，并把**平滑设置显式化**。
 *
 * Canvas 的 `imageSmoothingEnabled` 默认是 `true`（双线性），而 PIL 的 `paste()` 不做任何重采样。
 * 这个差异是「糊」和「不糊」的分界，所以这里默认设成 `false`（= 最接近 `paste` 的行为），
 * 需要插值的调用点显式打开。
 * @param {any} target `Canvas` 或 ctx
 * @param {{smooth?: boolean}} [opts]
 * @returns {any} `CanvasRenderingContext2D`
 */
export function ctx2d(target, opts = {}) {
  const ctx = typeof target.getContext === 'function' ? target.getContext('2d') : target;
  ctx.imageSmoothingEnabled = opts.smooth ?? false;
  return ctx;
}

/**
 * 直接贴（对应 `paste(src, (x,y))`，不合成、不缩放）。
 * @param {any} dst
 * @param {any} src
 * @param {number} x
 * @param {number} y
 */
export function blit(dst, src, x, y) {
  const ctx = ctx2d(dst);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(src, x, y);
}

/**
 * 裁剪 + 贴 + 缩放（对应 `crop` + `paste` + `resize` 的组合，施工说明 §5.3）。
 *
 * `smooth: false` 时是**最近邻**放大（对应 `Image.NEAREST`）。
 * 缩小要「区域平均」请用 `kit/raster.js` 的 `boxDownsample()` ——
 * **Canvas 没有 `Image.BOX` 的等价物**（`AGENTS.md` §7，施工说明 §8 风险 2）。
 * @param {any} dst
 * @param {any} src
 * @param {number} sx @param {number} sy @param {number} sw @param {number} sh
 * @param {number} dx @param {number} dy @param {number} dw @param {number} dh
 * @param {{smooth?: boolean}} [opts]
 */
export function blitRect(dst, src, sx, sy, sw, sh, dx, dy, dw, dh, opts = {}) {
  const ctx = ctx2d(dst, opts);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * alpha 合成（对应 `alpha_composite()`）—— 注意 PIL 是**原地**修改 `dst`。
 * @param {any} dst
 * @param {any} src
 * @param {number} [x] @param {number} [y]
 */
export function alphaOver(dst, src, x = 0, y = 0) {
  const ctx = ctx2d(dst);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(src, x, y);
}

/**
 * 线性混合（对应 `Image.blend(a, b, α)`：`out = a*(1-α) + b*α`）。
 *
 * 两种模式：
 * - `alpha` 是数：整体线性混合
 * - `alpha` 是 canvas：**当作 mask**，逐像素取它的 alpha 当权重（对应 `Image.composite`）
 * @param {any} dst 就是 `a`（原地）
 * @param {any} src `b`
 * @param {number|any} alpha 0..1，或一张 canvas 当 mask
 * @param {number} [x] @param {number} [y]
 */
export function blend(dst, src, alpha, x = 0, y = 0) {
  if (typeof alpha === 'number') {
    const ctx = ctx2d(dst);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, x, y);
    ctx.globalAlpha = 1;
    return;
  }
  maskChoose(dst, /** @type {any} */ (src), alpha, x, y);
}

/**
 * 按 mask 选择（对应 `Image.composite(a, b, mask)`：`mask` 亮的地方取 `a`，暗的地方取 `b`）。
 *
 * PIL 的 mask 是**单通道**图；Canvas 里没有单通道画布，所以约定
 * **mask 用一张 canvas 的 alpha 通道**（`getImageData().data[i+3]`）。
 * `kit/pixels.js` 是边界，中间一律非预乘 —— 这里正好在边界上。
 * @param {any} a 背景（原地修改）
 * @param {any} b 前景
 * @param {any} mask canvas，取它的 alpha
 * @param {number} [x] @param {number} [y]
 */
export function maskChoose(a, b, mask, x = 0, y = 0) {
  const dst = ctx2d(a);
  const w = a.width ?? dst.canvas.width;
  const h = a.height ?? dst.canvas.height;
  const base = rawRGBA(dst.canvas);
  const top = rawRGBA(b);
  const m = rawRGBA(mask);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = (yy * w + xx) * 4;
      const t = (yy - y) * top.width + (xx - x);
      const mm = (yy - y) * m.width + (xx - x);
      if (t < 0 || (yy - y) >= top.height || (xx - x) < 0 || (xx - x) >= top.width) continue;
      // mask 的 alpha 当权重
      const weight = mm >= 0 && (yy - y) < m.height && (xx - x) < m.width ? m.data[mm * 4 + 3] / 255 : 0;
      const ti = t * 4;
      for (let c = 0; c < 3; c++) {
        base.data[i + c] = Math.round(base.data[i + c] * (1 - weight) + top.data[ti + c] * weight);
      }
      base.data[i + 3] = Math.round(base.data[i + 3] * (1 - weight) + top.data[ti + 3] * weight);
    }
  }
  dst.putImageData(asImageData(dst, base), 0, 0);
}

/**
 * 通道取最大（对应 `ImageChops.lighter`）。
 *
 * ⚠️ **这是残影的关键算子**（施工说明 §6 Phase 4 第 2 条）：残影要用 `lighter` 而不是 `blend`，
 * 否则暗部也留痕，画面会糊成一团。
 * @param {any} dst 原地
 * @param {any} src
 * @param {number} [x] @param {number} [y]
 */
export function lighter(dst, src, x = 0, y = 0) {
  composite(dst, src, 'lighten', x, y);
}

/**
 * 通道取最小（对应 `ImageChops.darker`）。
 * @param {any} dst @param {any} src @param {number} [x] @param {number} [y]
 */
export function darker(dst, src, x = 0, y = 0) {
  composite(dst, src, 'darken', x, y);
}

/**
 * 逐通道相乘（对应 `ImageChops.multiply`）。
 * @param {any} dst @param {any} src @param {number} [x] @param {number} [y]
 */
export function multiply(dst, src, x = 0, y = 0) {
  composite(dst, src, 'multiply', x, y);
}

/**
 * 逐通道绝对差（对应 `ImageChops.difference`）—— 「同帧双渲」护栏用它。
 * 不过护栏真正用的是 `kit/pixels.js` 的 `diffRGBA()`（要报坐标），这里是给画面用的版本。
 * @param {any} dst @param {any} src @param {number} [x] @param {number} [y]
 */
export function difference(dst, src, x = 0, y = 0) {
  composite(dst, src, 'difference', x, y);
}

/**
 * 饱和加法（对应 `ImageChops.add`）。
 *
 * ⚠️ `'lighter'` 是 Canvas 里语义最接近的算子；`'lighter'` 会**把 alpha 也相加**，
 * 所以叠在很多层上要留意。辉光用它（施工说明 §6 Phase 4）。
 * @param {any} dst @param {any} src @param {number} [x] @param {number} [y]
 */
export function add(dst, src, x = 0, y = 0) {
  composite(dst, src, 'lighter', x, y);
}

/**
 * 通用的合成算子调用（对应 `ImageChops` 家族）。
 * @param {any} dst
 * @param {any} src
 * @param {GlobalCompositeOperation} op
 * @param {number} [x] @param {number} [y]
 */
export function composite(dst, src, op, x = 0, y = 0) {
  const ctx = ctx2d(dst);
  const prev = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = 1;
  ctx.drawImage(src, x, y);
  ctx.globalCompositeOperation = prev;
  ctx.globalAlpha = prevAlpha;
}

/**
 * 在图上清一个矩形为透明（对应 `ImageDraw.rectangle` + 清空，或 `paste` 一张空白）。
 * @param {any} target
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export function clearRect(target, x, y, w, h) {
  const ctx = ctx2d(target);
  ctx.clearRect(x, y, w, h);
}

/**
 * 取子区域（对应 `crop`）。**注意**：Canvas 没有「引用式 crop」，这里会**拷一张新画布**。
 *
 * PIL 的 `crop()` 是惰性的（共享像素缓冲），Canvas 不是 —— 反复 crop 会产生很多小画布，
 * 逐帧路径上要缓存（`Map`），别每帧新建。
 * @param {any} src
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function crop(src, x, y, w, h) {
  const out = createCanvas(w, h);
  blitRect(out, src, x, y, w, h, 0, 0, w, h, { smooth: false });
  return out;
}

/**
 * 把 `RawImage` 包成该 ctx 能用的 `ImageData`。
 * @param {any} ctx
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img
 * @returns {any} `ImageData`
 */
function asImageData(ctx, img) {
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  return id;
}

/**
 * 像素级读写口（对应 `load()` / `getpixel` / `putpixel`）：拿到 `RawImage`，
 * 改完用 `writePixels()` 写回。
 *
 * **约定**：进出这里时数据是**非预乘 RGBA**；中间的算法用非预乘。
 * @param {any} src
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function readPixels(src) {
  return rawRGBA(src);
}

/**
 * @param {any} dst
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img
 */
export function writePixels(dst, img) {
  const ctx = ctx2d(dst);
  ctx.putImageData(asImageData(ctx, img), 0, 0);
}

/**
 * 把 canvas 编码成 PNG buffer（对应 `save()`）。日志、抽查、对拍时用。
 * @param {any} canvas
 * @param {?string} [path] 给了就同时落盘（目录不存在会建）
 * @returns {Buffer}
 */
export function encodePng(canvas, path = null) {
  const buf = canvas.toBuffer('image/png');
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
  }
  return buf;
}

/**
 * 把 canvas 变成「能喂 ffmpeg 的 rgb24 buffer」，并**当场断言**。
 *
 * 施工说明 §5.4 第 1 条：喂管道前断言尺寸与像素格式 —— 这是「花屏」类事故的唯一原因。
 * @param {any} canvas
 * @param {number} w @param {number} h
 * @returns {Buffer}
 */
export function toRgb24(canvas, w, h) {
  assertSize(canvas, w, h, 'toRgb24');
  const buf = rawRGB(canvas);
  assertRgb24Buffer(buf, w, h, 'toRgb24');
  return buf;
}

