/**
 * film/kit/color.js — 调色（PIL 的 `ImageOps` / `ImageEnhance` 等价物）。
 *
 * 都走 LUT 或一次性像素循环，不做逐像素的浮点乘除链（`AGENTS.md` §7：
 * 「调色走 LUT（`Uint8ClampedArray` 查表）而不是逐像素循环」——
 * 这里只有 `colorize` 因为要在两个色点之间插值才逐像素算，但它只算 **256 项**然后查表）。
 */

import { applyLut, emptyRaw, stats, stretchLut } from './raster.js';

/**
 * @typedef {import('./pixels.js').RawImage} RawImage
 * @typedef {[number, number, number]} RGB
 */

/**
 * 灰度化（对应 `ImageOps.grayscale`）。
 *
 * 权重与 PIL **完全一致**：`L = R*299/1000 + G*587/1000 + B*114/1000`（**向下取整**，不是四舍五入）。
 * 这一点必须照抄 —— 权重一致但取整方式不同，字符网格降采样出来的画面会整体偏一档。
 * 输出的 RGB 三通道相同，alpha 保持原样。
 * @param {RawImage} img 原地修改
 * @returns {RawImage} 同一个对象
 */
export function toGray(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; // Python 的 // 对正数是向下取整
    const g = v < 0 ? 0 : v > 255 ? 255 : Math.floor(v);
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
  }
  return img;
}

/**
 * 非原地灰度化（要保留原图时用）。
 * @param {RawImage} img
 * @returns {RawImage}
 */
export function grayscale(img) {
  return toGray({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
}

/**
 * 自动对比度（对应 `ImageOps.autocontrast`）。
 *
 * PIL 的做法：按**直方图**统计，切掉两端各 `cutoff`（默认 0）比例的像素 → 得到 `(lo, hi)` →
 * 线性拉伸到 `[0, 255]`。不是简单的 min/max 拉伸。
 * @param {RawImage} img 原地修改
 * @param {{cutoff?: number, ignore?: ?number}} [opts] `cutoff` 是 0..100 的百分比
 * @returns {RawImage} 同一个对象
 */
export function autoContrast(img, opts = {}) {
  const cutoff = opts.cutoff ?? 0;
  const ignore = opts.ignore ?? null;
  const hist = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // 用灰度加权统计（PIL 在 RGB 图上按每通道各算一次，取整后是同一张表；这里统一用亮度）
    const v = Math.floor((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
    if (ignore !== null && v === ignore) continue;
    hist[v]++;
  }
  const total = hist.reduce((a, b) => a + b, 0);
  const cut = Math.floor((total * cutoff) / 100);
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > cut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > cut) {
      hi = v;
      break;
    }
  }
  if (hi <= lo) return img; // 纯色图，没什么可拉伸的
  return applyLut(img, stretchLut(lo, hi));
}

/**
 * 双色映射（对应 `ImageOps.colorize(gray, black, white)`）。
 *
 * 语义：灰度 0 → `black`，255 → `white`，中间**线性插值**（PIL 是逐通道线性）。
 * 实现：只为 256 个灰度值算出三张 LUT，然后整图查表 —— 不是逐像素插值。
 * @param {RawImage} img 原地修改
 * @param {RGB|number} black @param {RGB|number} white
 * @param {{mid?: ?RGB, blackpoint?: number, whitepoint?: number}} [opts]
 *   `mid` 给了就做三段映射（对应 PIL 的 `mid` 参数）
 * @returns {RawImage} 同一个对象
 */
export function colorize(img, black, white, opts = {}) {
  const bk = norm(black);
  const wh = norm(white);
  const mid = opts.mid ? norm(opts.mid) : null;
  const bp = opts.blackpoint ?? 0;
  const wp = opts.whitepoint ?? 255;

  const lr = new Uint8Array(256);
  const lg = new Uint8Array(256);
  const lb = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    // 先按 blackpoint/whitepoint 归一化，再插值
    let t = (v - bp) / Math.max(1, wp - bp);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let c;
    if (mid && t < 0.5) {
      c = lerp3(bk, mid, t * 2);
    } else if (mid) {
      c = lerp3(mid, wh, (t - 0.5) * 2);
    } else {
      c = lerp3(bk, wh, t);
    }
    lr[v] = c[0];
    lg[v] = c[1];
    lb[v] = c[2];
  }
  return applyLut(img, lr, { r: lr, g: lg, b: lb });
}

/**
 * 对比度增强（对应 `ImageEnhance.Contrast`）。
 *
 * PIL 的语义：先把图转灰度求均值，再按 `factor` 围绕均值缩放每个通道。
 * `factor = 1` 不变；`0` 全变灰；`2` 对比度翻倍。
 * @param {RawImage} img 原地修改
 * @param {number} factor
 * @returns {RawImage}
 */
export function enhanceContrast(img, factor) {
  const st = stats(img);
  const mean = (st.mean[0] + st.mean[1] + st.mean[2]) / 3;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const x = v - mean;
    const y = mean + factor * x;
    lut[v] = y < 0 ? 0 : y > 255 ? 255 : Math.round(y);
  }
  return applyLut(img, lut);
}

/**
 * 亮度增强（对应 `ImageEnhance.Brightness`）：`out = v * factor`。
 * @param {RawImage} img 原地修改 @param {number} factor
 * @returns {RawImage}
 */
export function enhanceBrightness(img, factor) {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const y = v * factor;
    lut[v] = y < 0 ? 0 : y > 255 ? 255 : Math.round(y);
  }
  return applyLut(img, lut);
}

/**
 * 按比例把图染成某个色相（保留亮度，用于「层堆叠」的氛围色）。
 * @param {RawImage} img 原地修改
 * @param {RGB} tint @param {number} amount 0..1
 * @returns {RawImage}
 */
export function tint(img, tint_, amount) {
  const t = norm(tint_);
  const lr = new Uint8Array(256);
  const lg = new Uint8Array(256);
  const lb = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lr[v] = Math.round(v * (1 - amount) + ((v * t[0]) / 255) * amount);
    lg[v] = Math.round(v * (1 - amount) + ((v * t[1]) / 255) * amount);
    lb[v] = Math.round(v * (1 - amount) + ((v * t[2]) / 255) * amount);
  }
  return applyLut(img, lr, { r: lr, g: lg, b: lb });
}

/**
 * 生成一张纯色图（对应 `Image.new('RGB', size, color)` 的像素版本）。
 * @param {number} w @param {number} h @param {RGB} rgb @param {number} [a]
 * @returns {RawImage}
 */
export function solidRaw(w, h, rgb, a = 255) {
  const out = emptyRaw(w, h);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = rgb[0];
    out.data[i + 1] = rgb[1];
    out.data[i + 2] = rgb[2];
    out.data[i + 3] = a;
  }
  return out;
}

/**
 * @param {RGB|number} c
 * @returns {RGB}
 */
function norm(c) {
  if (typeof c === 'number') return [c, c, c];
  return [c[0], c[1], c[2]];
}

/**
 * @param {RGB} a @param {RGB} b @param {number} t
 * @returns {RGB}
 */
function lerp3(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
