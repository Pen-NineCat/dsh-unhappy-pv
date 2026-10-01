/**
 * film/kit/raster.js — 位图变换原语（PIL 的 `Image` / `ImageOps` / `ImageFilter` / `ImageStat` 等价物）。
 *
 * 这一层全是**手写**的，理由见施工说明 §2.1：
 * 确定性可控、零额外原生依赖。施工说明附录 A 里标 🔴/⚠️ 的几项都在这里：
 *
 * - **`boxDownsample` 必须手写**：Canvas 的 `drawImage` 缩小是双线性/面积混合，
 *   `sharp` 的 kernel 里**没有 box**，而参考项目用了 23 处 `Image.BOX`（`AGENTS.md` §7）。
 * - **`gaussianBlur` 可分离实现**：sigma 与 radius 的换算与 PIL 不同，靠视觉对拍确认，
 *   不要照抄 `radius=4`（施工说明 §6 Phase 2 第 2 条）。
 * - **预乘 alpha**：进出 `kit/pixels.js` 时统一到非预乘，中间全用非预乘。
 *
 * 逃生舱（施工说明 §8 风险 5）：若 Phase 4 profiling 显示后期成为瓶颈，
 * 把本文件内部换成 `sharp` 即可 —— `content/` 只依赖 `kit/` 接口，这是一处改动。
 */

import { createCanvas } from '@napi-rs/canvas';

import { rawRGBA, putRGBA } from './pixels.js';

/**
 * @typedef {import('./pixels.js').RawImage} RawImage
 */

/**
 * 建一张原始像素缓冲（不经 canvas），给「算完再贴回去」的路径用。
 * @param {number} w @param {number} h
 * @returns {RawImage}
 */
export function emptyRaw(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/**
 * 深拷一份。
 * @param {RawImage} img
 * @returns {RawImage}
 */
export function cloneRaw(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * 把 `RawImage` 贴回 canvas（就地）。
 * @param {any} dst @param {RawImage} img
 */
export function writeRawTo(dst, img) {
  putRGBA(dst, img);
  return dst;
}

/**
 * 取一份可改的像素缓冲（`load()` 的等价物）。
 * @param {any} src
 * @returns {RawImage}
 */
export function readRaw(src) {
  return rawRGBA(src);
}

// ── LUT（对应 `point()`）────────────────────────────────────────────────

/**
 * 逐通道查表（对应 `img.point(lut)`）。
 *
 * 两个分量：
 * - `lut`：长度 256 的查表，**同一个表打在 R/G/B 三个通道上**（PIL 的单表行为）
 * - `opts.r/g/b`：也可以给三张不同的表（对应 PIL 传 3 个 lut）
 *
 * ⚠️ alpha **不动**：PIL 的 `point()` 在 RGB 图上没有 alpha，在 RGBA 上默认也只动前三个通道。
 * @param {RawImage} img 原地修改
 * @param {Uint8Array|Uint8ClampedArray} lut
 * @param {{r?: Uint8Array, g?: Uint8Array, b?: Uint8Array, alpha?: Uint8Array}} [opts]
 * @returns {RawImage} 同一个对象（就地）
 */
export function applyLut(img, lut, opts = {}) {
  if (lut.length !== 256) throw new Error(`applyLut: lut 长度必须是 256，收到 ${lut.length}`);
  const lr = opts.r ?? /** @type {any} */ (lut);
  const lg = opts.g ?? /** @type {any} */ (lut);
  const lb = opts.b ?? /** @type {any} */ (lut);
  const la = opts.alpha ?? null;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
    if (la) d[i + 3] = la[d[i + 3]];
  }
  return img;
}

/**
 * 生成一张「反色」LUT（`lut[v] = 255 - v`）。Phase 2 的验收样例之一。
 * @returns {Uint8Array}
 */
export function invertLut() {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 - v;
  return lut;
}

/**
 * 生成一张线性拉伸 LUT（`ImageOps.autocontrast` 的核心步骤，单独暴露便于复用）。
 * @param {number} lo 输入下界（映射到 0）
 * @param {number} hi 输入上界（映射到 255）
 * @returns {Uint8Array}
 */
export function stretchLut(lo, hi) {
  const lut = new Uint8Array(256);
  const span = Math.max(1, hi - lo);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(((v - lo) * 255) / span)));
  }
  return lut;
}

// ── 通道（对应 `split()` / `merge()` / `getchannel()` / `putalpha()`）────

/**
 * 拆通道（对应 `split()`）。返回 4 个**单通道灰度画布**。
 * @param {RawImage} img
 * @returns {{r: import('@napi-rs/canvas').Canvas, g: any, b: any, a: any}}
 */
export function splitChannels(img) {
  return {
    r: channelCanvas(img, 0),
    g: channelCanvas(img, 1),
    b: channelCanvas(img, 2),
    a: channelCanvas(img, 3),
  };
}

/**
 * 取单个通道当灰度图（对应 `getchannel(ch)`）。
 * @param {RawImage} img @param {0|1|2|3} ch
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function getChannel(img, ch) {
  return channelCanvas(img, ch);
}

/**
 * @param {RawImage} img @param {number} ch
 * @returns {import('@napi-rs/canvas').Canvas}
 */
function channelCanvas(img, ch) {
  const out = createCanvas(img.width, img.height);
  const ctx = out.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i + ch];
    id.data[i] = v;
    id.data[i + 1] = v;
    id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

/**
 * 合通道（对应 `merge()`）：4 张单通道图 → 一张 RGBA。
 * 传 `null` 的通道按 alpha 满、颜色 0 处理。
 * @param {?RawImage} r @param {?RawImage} g @param {?RawImage} b @param {?RawImage} a
 * @returns {RawImage}
 */
export function mergeChannels(r, g, b, a) {
  const any = r ?? g ?? b ?? a;
  if (!any) throw new Error('mergeChannels: 至少要给一个通道');
  const { width, height } = any;
  const out = emptyRaw(width, height);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = r ? r.data[i] : 0;
    out.data[i + 1] = g ? g.data[i] : 0;
    out.data[i + 2] = b ? b.data[i] : 0;
    out.data[i + 3] = a ? a.data[i] : 255;
  }
  return out;
}

/**
 * 换 alpha（对应 `putalpha()`）：把 `alphaImg` 的某个通道当 alpha 写进去。
 * @param {RawImage} img 原地
 * @param {RawImage} alphaImg
 * @param {0|1|2|3} [ch] 取 alphaImg 的哪个通道，默认 `3`
 * @returns {RawImage}
 */
export function setAlpha(img, alphaImg, ch = 3) {
  if (alphaImg.width !== img.width || alphaImg.height !== img.height) {
    throw new Error(
      `setAlpha 尺寸不一致：${alphaImg.width}×${alphaImg.height} vs ${img.width}×${img.height}`,
    );
  }
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = alphaImg.data[i + ch];
  return img;
}

// ── 🔴 box 降采样（`Image.BOX`，无等价物，必须手写）─────────────────────

/**
 * 区域算术平均降采样（对应 `resize((w,h), Image.BOX)`）。
 *
 * **语义**（施工说明 §8 风险 2）：每个输出像素 = 对应输入矩形内所有像素的**算术平均**。
 *
 * 边界取 `lo_i = floor(i*sw/dw)`、`hi_i = floor((i+1)*sw/dw)`（最后一格补到 `sw`），
 * 于是这些矩形**恰好铺满**源图：**每个源像素被用且只被用一次**（不重不漏）。
 *
 * ⚠️ 这条「不重不漏」不是洁癖，是**正确性**：参考项目那 23 处 `Image.BOX` 全是
 * 「图像 → 字符网格」的降采样（每个 cell 求平均亮度），
 * 一旦某个源像素被两个 cell 各算一次、或者有 cell 一个像素都没覆盖，
 * 算出来的字就整体偏亮/偏暗。所以这里不用 `floor..ceil`（那在 `sw/dw > 1` 时会重叠）。
 *
 * 放大时（`dw > sw`）退化为最近邻；缩小要用别的核（BILINEAR/LANCZOS）请走 `blitRect`。
 * 不要用 `ctx.drawImage` 缩小去凑 —— 那是双线性/面积混合，结果与 `Image.BOX` 不同。
 * @param {RawImage} img
 * @param {number} dw 目标宽
 * @param {number} dh 目标高
 * @returns {RawImage}
 */
export function boxDownsample(img, dw, dh) {
  if (!Number.isInteger(dw) || !Number.isInteger(dh) || dw <= 0 || dh <= 0) {
    throw new Error(`boxDownsample: 目标尺寸必须是正整数，收到 ${dw}×${dh}`);
  }
  const sw = img.width;
  const sh = img.height;
  const out = emptyRaw(dw, dh);
  const src = img.data;
  const dst = out.data;
  // 整数边界表：x0[i]..x1[i] 是第 i 格覆盖的源列区间（左闭右开），最后一格补到 sw
  const xs = bounds(sw, dw);
  const ys = bounds(sh, dh);

  for (let dy = 0; dy < dh; dy++) {
    const [y0, y1] = ys[dy];
    for (let dx = 0; dx < dw; dx++) {
      const [x0, x1] = xs[dx];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const o = (dy * dw + dx) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * 把 `srcLen` 个源像素铺进 `dstLen` 个格子，返回每格的 `[start, end)`。
 *
 * 性质（`boxDownsample` 依赖它们）：
 * - 相邻格首尾相接：`end[i] === start[i+1]`
 * - 不重不漏：`start[0] === 0`、`end[last] === srcLen`
 * - 每格至少一个源像素（`dstLen <= srcLen` 时）
 * @param {number} srcLen @param {number} dstLen
 * @returns {Array<[number, number]>}
 */
export function bounds(srcLen, dstLen) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < dstLen; i++) {
    const lo = Math.floor((i * srcLen) / dstLen);
    out.push([lo, lo]);
  }
  for (let i = 1; i < dstLen; i++) out[i - 1][1] = out[i][0];
  if (dstLen > 0) out[dstLen - 1][1] = srcLen;
  // 放大时（dstLen > srcLen）会出现空区间，退化成「最近邻」：把空格并到前一格之后
  for (let i = 0; i < dstLen; i++) {
    if (out[i][1] <= out[i][0]) {
      const at = Math.min(srcLen - 1, Math.floor((i * srcLen) / dstLen));
      out[i][0] = at;
      out[i][1] = Math.min(srcLen, at + 1);
    }
  }
  return out;
}

// ── 高斯模糊（可分离）────────────────────────────────────────────────────

/**
 * 生成归一化的一维高斯核。
 *
 * ⚠️ **sigma ≠ radius**：PIL 的 `GaussianBlur(radius)` 内部 `sigma = radius`（近似半径语义），
 * 而这里直接用 `sigma`。换算关系要**视觉对拍**确认，不要照抄参考项目的 `radius=4`。
 *
 * `radiusOverride` 的意义（性能）：默认取 `ceil(3*sigma)`，3σ 之外的核值 < 0.3%，
 * 但代价是线性的。取 `ceil(2.5*sigma)` 能省 1/6 的时间且视觉无差 ——
 * 见 `gaussianBlur()` 的性能说明。
 * @param {number} sigma
 * @param {number} [radiusOverride]
 * @returns {Float64Array} 长度 `2*radius+1`
 */
export function gaussianKernel(sigma, radiusOverride) {
  const radius =
    radiusOverride && radiusOverride > 0
      ? Math.max(0, Math.round(radiusOverride))
      : Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(radius * 2 + 1);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / denom);
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/**
 * 可分离高斯模糊（对应 `ImageFilter.GaussianBlur`）—— 两次一维卷积，不要二维核。
 *
 * 边界处理：**用边缘像素延拓**（clamp），不是补零 —— 补零会在画面边缘压出一圈黑边。
 * alpha 也一起模糊（PIL 的 `RGBA` 图同样会）。
 *
 * ⚠️ **性能**：朴素实现是 O(w·h·radius)。2026-10-01 在 1920×1080 上实测
 * `sigma=8`（radius 24）要 **851 ms** —— 是单帧预算（41.7 ms）的 20 倍（见施工说明附录 C）。
 * 所以这里给了两条路：
 *
 * - `opts.radius`：**把 radius 压到 sigma 的 2–3 倍**而不是 3 倍以上。高斯尾部在 2.5σ 以上
 *   已经小于 1/255，视觉上不可见，但省下的时间线性。
 * - `opts.box`：跑 **3 遍滑动窗口 box 模糊**（每像素每遍 O(1)，与 radius 无关）。
 *   3 遍 box 在视觉上已经**极难**与真高斯区分，而复杂度从 O(radius) 掉到 O(1)。
 *   ⚠️ 它**不是**逐像素等价于 `gaussianKernel` —— 想严格对拍就用默认的核卷积。
 *
 * 更狠的一招留给 Phase 4：**降分辨率模糊再放大**（辉光本来就不需要全分辨率），
 * 或者干脆在 1/4 尺寸上做 bloom。
 * @param {RawImage} img
 * @param {number} sigma `<= 0.5` 时原样返回（避免无意义的卷积）
 * @param {{radius?: number, box?: boolean}} [opts]
 * @returns {RawImage} 新图
 */
export function gaussianBlur(img, sigma, opts = {}) {
  if (!(sigma > 0)) return cloneRaw(img);
  if (sigma <= 0.5) return cloneRaw(img);
  if (opts.box) return boxBlurApprox(img, sigma, opts.radius);
  const k = gaussianKernel(sigma, opts.radius);
  const r = (k.length - 1) / 2;
  const { width: w, height: h } = img;
  const src = img.data;

  // 按 RGBA 交错布局卷积：**一次过 4 个通道**，`si` 连续读、`si+1..3` 命中同一个 cache line，
  // 而且四个独立的累加器在 V8 里能并行起来。
  //
  // 2026-10-01 实测过一版「拆成 4 个连续平面再卷积」的写法，以为能省内存带宽，
  // 结果在 1920×1080 / sigma=8 上**更慢**（1186 ms vs 896 ms）——
  // 多出来的 8 次整图 Float32Array 分配与平面化/还原搬运吃掉了收益。
  // 结论：**别拆平面**。热路径上少一次整图拷贝比「访问模式更整齐」值钱。
  const tmp = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i;
        if (xx < 0) xx = 0;
        else if (xx >= w) xx = w - 1;
        const kv = k[i + r];
        const si = rowOff + xx * 4;
        a0 += src[si] * kv;
        a1 += src[si + 1] * kv;
        a2 += src[si + 2] * kv;
        a3 += src[si + 3] * kv;
      }
      const o = rowOff + x * 4;
      tmp[o] = a0;
      tmp[o + 1] = a1;
      tmp[o + 2] = a2;
      tmp[o + 3] = a3;
    }
  }

  // 纵向
  const out = emptyRaw(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        const kv = k[i + r];
        const si = (yy * w + x) * 4;
        a0 += tmp[si] * kv;
        a1 += tmp[si + 1] * kv;
        a2 += tmp[si + 2] * kv;
        a3 += tmp[si + 3] * kv;
      }
      const o = (y * w + x) * 4;
      dst[o] = Math.round(a0);
      dst[o + 1] = Math.round(a1);
      dst[o + 2] = Math.round(a2);
      dst[o + 3] = Math.round(a3);
    }
  }
  return out;
}

/**
 * 用三遍滑动窗口 box 模糊近似高斯（每像素每遍 O(1)，与半径无关）。
 *
 * 为什么 3 遍：连续 3 次 box 卷积按中心极限定理已经非常接近高斯，
 * 视觉差异在 8 bit 下基本看不出来（这一点要**视觉对拍**确认，不是靠这句话）。
 * 半径按 Ivan Kutskir 的经典取法从 sigma 反推。
 *
 * 内部用**整数累加器 + 两遍横两遍纵**；边界用边缘延拓。
 * @param {RawImage} img
 * @param {number} sigma
 * @param {number} [radiusOverride] 强制半径（`<=0` 表示不限）
 * @returns {RawImage}
 */
export function boxBlurApprox(img, sigma, radiusOverride) {
  let r = radiusOverride && radiusOverride > 0 ? Math.round(radiusOverride) : Math.round(sigma * 1.5);
  // 三个 box 宽度都要是奇数，且满足 boxesForGauss 的归一化
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  if (!(radiusOverride && radiusOverride > 0)) r = 0; // 用下面的 boxes 取法，不用单一 radius
  /** @type {number[]} */
  const boxes = [];
  for (let i = 0; i < 3; i++) boxes.push(((i < m ? wl : wu) - 1) / 2);
  if (r > 0) boxes.fill(r);

  let cur = cloneRaw(img);
  for (const radius of boxes) {
    if (radius < 1) continue;
    cur = boxBlurH(cur, radius);
    cur = boxBlurV(cur, radius);
  }
  return cur;
}

/**
 * 横向 box 模糊（滑动窗口，O(1) / 像素）。
 * @param {RawImage} img @param {number} r
 * @returns {RawImage}
 */
function boxBlurH(img, r) {
  const { width: w, height: h } = img;
  const src = img.data;
  const out = emptyRaw(w, h);
  const dst = out.data;
  const norm = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    // 初始窗口：左边界用第 0 列补齐（边缘延拓）
    for (let i = -r; i <= r; i++) {
      const x = i < 0 ? 0 : i >= w ? w - 1 : i;
      const si = row + x * 4;
      s0 += src[si];
      s1 += src[si + 1];
      s2 += src[si + 2];
      s3 += src[si + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = Math.round(s0 * norm);
      dst[o + 1] = Math.round(s1 * norm);
      dst[o + 2] = Math.round(s2 * norm);
      dst[o + 3] = Math.round(s3 * norm);
      // 滑一格：进右、出左
      const xIn = x + r + 1 >= w ? w - 1 : x + r + 1;
      const xOut = x - r < 0 ? 0 : x - r;
      const iIn = row + xIn * 4;
      const iOut = row + xOut * 4;
      s0 += src[iIn] - src[iOut];
      s1 += src[iIn + 1] - src[iOut + 1];
      s2 += src[iIn + 2] - src[iOut + 2];
      s3 += src[iIn + 3] - src[iOut + 3];
    }
  }
  return out;
}

/**
 * 纵向 box 模糊（滑动窗口，O(1) / 像素）。
 * @param {RawImage} img @param {number} r
 * @returns {RawImage}
 */
function boxBlurV(img, r) {
  const { width: w, height: h } = img;
  const src = img.data;
  const out = emptyRaw(w, h);
  const dst = out.data;
  const norm = 1 / (r + r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = -r; i <= r; i++) {
      const y = i < 0 ? 0 : i >= h ? h - 1 : i;
      const si = col + y * stride;
      s0 += src[si];
      s1 += src[si + 1];
      s2 += src[si + 2];
      s3 += src[si + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = col + y * stride;
      dst[o] = Math.round(s0 * norm);
      dst[o + 1] = Math.round(s1 * norm);
      dst[o + 2] = Math.round(s2 * norm);
      dst[o + 3] = Math.round(s3 * norm);
      const yIn = y + r + 1 >= h ? h - 1 : y + r + 1;
      const yOut = y - r < 0 ? 0 : y - r;
      const iIn = col + yIn * stride;
      const iOut = col + yOut * stride;
      s0 += src[iIn] - src[iOut];
      s1 += src[iIn + 1] - src[iOut + 1];
      s2 += src[iIn + 2] - src[iOut + 2];
      s3 += src[iIn + 3] - src[iOut + 3];
    }
  }
  return out;
}

// ── 卷积 / 形态学（对应 `ImageFilter.Kernel` / `MaxFilter` / `MinFilter`）──

/**
 * 3×3 卷积（对应 `ImageFilter.Kernel`）。Sobel 之类的边缘检测用它。
 *
 * 语义按 PIL：`out = sum(kernel[i] * pixel[i]) / scale + offset`，超出 `[0,255]` 截断。
 * `scale` 缺省 = kernel 之和（为 0 时用 1，避免除零）。
 * alpha **不参与**（PIL 的 3×3 Kernel 只作用于 RGB）。
 * @param {RawImage} img
 * @param {number[]} kernel 长度 9，行优先
 * @param {{scale?: number, offset?: number}} [opts]
 * @returns {RawImage}
 */
export function convolve3x3(img, kernel, opts = {}) {
  if (kernel.length !== 9) throw new Error(`convolve3x3: kernel 长度必须是 9，收到 ${kernel.length}`);
  const sum = kernel.reduce((a, b) => a + b, 0);
  const scale = opts.scale ?? (sum === 0 ? 1 : sum);
  const offset = opts.offset ?? 0;
  const { width: w, height: h } = img;
  const src = img.data;
  const out = emptyRaw(w, h);
  const dst = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc0 = 0;
      let acc1 = 0;
      let acc2 = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -1; dx <= 1; dx++, ki++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const kv = kernel[ki];
          if (kv === 0) continue;
          const si = (yy * w + xx) * 4;
          acc0 += src[si] * kv;
          acc1 += src[si + 1] * kv;
          acc2 += src[si + 2] * kv;
        }
      }
      const o = (y * w + x) * 4;
      dst[o] = clamp255(acc0 / scale + offset);
      dst[o + 1] = clamp255(acc1 / scale + offset);
      dst[o + 2] = clamp255(acc2 / scale + offset);
      dst[o + 3] = src[o + 3];
    }
  }
  return out;
}

/**
 * 取窗口内最大值（对应 `ImageFilter.MaxFilter(size)`）。`size` 必须是奇数。
 * @param {RawImage} img
 * @param {number} size
 * @returns {RawImage}
 */
export function maxFilter(img, size) {
  return rankFilter(img, size, 'max');
}

/**
 * 取窗口内最小值（对应 `ImageFilter.MinFilter(size)`）。
 * @param {RawImage} img
 * @param {number} size
 * @returns {RawImage}
 */
export function minFilter(img, size) {
  return rankFilter(img, size, 'min');
}

/**
 * @param {RawImage} img @param {number} size @param {'max'|'min'} mode
 * @returns {RawImage}
 */
function rankFilter(img, size, mode) {
  if (!Number.isInteger(size) || size < 1 || size % 2 === 0) {
    throw new Error(`${mode}Filter: size 必须是正奇数，收到 ${size}`);
  }
  const r = (size - 1) / 2;
  const { width: w, height: h } = img;
  const src = img.data;
  const out = emptyRaw(w, h);
  const dst = out.data;
  const pick = mode === 'max' ? Math.max : Math.min;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v0 = mode === 'max' ? 0 : 255;
      let v1 = v0;
      let v2 = v0;
      let v3 = v0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const si = (yy * w + xx) * 4;
          v0 = pick(v0, src[si]);
          v1 = pick(v1, src[si + 1]);
          v2 = pick(v2, src[si + 2]);
          v3 = pick(v3, src[si + 3]);
        }
      }
      const o = (y * w + x) * 4;
      dst[o] = v0;
      dst[o + 1] = v1;
      dst[o + 2] = v2;
      dst[o + 3] = v3;
    }
  }
  return out;
}

/**
 * 逐通道绝对差（对应 `ImageChops.difference`）。
 *
 * 用途：转场里判断「这一格到底有没有换东西」。参考项目用它区分
 * 「old/new 有墨的地方」与背景，只在有墨的格子叠解码字符（施工说明 §6 Phase 4 第 3 条）。
 * @param {RawImage} a @param {RawImage} b
 * @returns {RawImage} 新图
 */
export function difference(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`difference 尺寸不一致：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const out = emptyRaw(a.width, a.height);
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      out.data[i + c] = Math.abs(a.data[i + c] - b.data[i + c]);
    }
  }
  return out;
}

// ── 统计（护栏用；对应 `ImageStat.Stat` / `getbbox()`）───────────────────

/**
 * 逐通道统计（对应 `ImageStat.Stat`：`mean` / `stddev` / `extrema`）。
 *
 * 标准差是**总体**标准差（除以 n），与 PIL 一致 —— 不是样本标准差。
 * @param {RawImage} img
 * @returns {{mean: number[], stddev: number[], min: number[], max: number[], count: number}}
 */
export function stats(img) {
  const chans = [0, 1, 2, 3];
  const n = img.width * img.height;
  const sum = [0, 0, 0, 0];
  const sum2 = [0, 0, 0, 0];
  const min = [255, 255, 255, 255];
  const max = [0, 0, 0, 0];
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (const c of chans) {
      const v = d[i + c];
      sum[c] += v;
      sum2[c] += v * v;
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  const mean = chans.map((c) => sum[c] / n);
  const stddev = chans.map((c) => Math.sqrt(Math.max(0, sum2[c] / n - (sum[c] / n) ** 2)));
  return {
    mean,
    stddev,
    min,
    max,
    count: n,
  };
}

/**
 * 单张灰度值的标准差（「无空白帧」护栏用，`AGENTS.md` §8）。
 * 纯色帧 ≈ 0 就是注入失败的信号。
 * @param {RawImage} img
 * @returns {number} RGB 三通道合并后的总体标准差
 */
export function stddev(img) {
  const d = img.data;
  const n = img.width * img.height * 3;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = d[i + c];
      sum += v;
      sum2 += v * v;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

/**
 * 非透明区域包围盒（对应 `getbbox()`）。
 *
 * `alpha: false` 时按「与纯黑不同」判断（对应 RGB 图的 `getbbox()`，它把 (0,0,0) 当背景）。
 * @param {RawImage} img
 * @param {{alpha?: boolean, x0?: number, y0?: number, x1?: number, y1?: number}} [opts]
 * @returns {?{x0: number, y0: number, x1: number, y1: number}} 全空时返回 `null`
 */
export function bbox(img, opts = {}) {
  const useAlpha = opts.alpha ?? true;
  const x0 = opts.x0 ?? 0;
  const y0 = opts.y0 ?? 0;
  const x1 = opts.x1 ?? img.width - 1;
  const y1 = opts.y1 ?? img.height - 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      const ink = useAlpha ? d[i + 3] !== 0 : d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0;
      if (!ink) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  // PIL 的 getbbox 是**左闭右开**，所以右/下边界 +1
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

/**
 * @param {number} v
 * @returns {number}
 */
function clamp255(v) {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}
