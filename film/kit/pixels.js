/**
 * film/kit/pixels.js — 画布 ↔ 字节的**唯一**边界。
 *
 * 为什么单独一个文件：`AGENTS.md` §7 定了三条容易踩的纪律，全都发生在这一层——
 *
 * 1. **alpha 只在边界转换**：Canvas2D 内部用预乘 alpha，`getImageData()` 返回**非预乘**。
 *    规矩是「进出这个文件时统一到非预乘」，中间层一律非预乘。
 * 2. **喂 ffmpeg 的必须是 rgb24**：像素顺序 = `R,G,B,R,G,B,…`，buffer 长度 = `W*H*3`。
 *    长度不对就是「花屏」类事故的唯一原因，所以这里有断言（施工说明 §5.4 第 1 条）。
 * 3. **尺寸断言**：任何要喂管道 / 要哈希的图，都得先确认它是 `W×H`。
 *
 * 这里刻意只做「搬运 + 断言」，不做任何变换 —— 变换在 `kit/raster.js`。
 */

/**
 * @typedef {Object} RawImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data 非预乘 RGBA，长度 `width*height*4`
 */

/**
 * 断言画布尺寸。
 * @param {{width: number, height: number}} img
 * @param {number} w
 * @param {number} h
 * @param {string} [what] 出错时好定位的上下文
 * @throws {Error}
 */
export function assertSize(img, w, h, what = 'image') {
  if (!img || img.width !== w || img.height !== h) {
    throw new Error(
      `${what} 尺寸断言失败：期望 ${w}×${h}，实际 ${img ? `${img.width}×${img.height}` : '(空)'}\n` +
        `  hint: 尺寸只从 film/engine/clock.js 的 W/H 来；对不上就是有个地方自己写了数字`,
    );
  }
}

/**
 * 从任意 canvas / context 取非预乘 RGBA。
 * @param {any} src `Canvas` 或 `CanvasRenderingContext2D`（`@napi-rs/canvas`）
 * @returns {RawImage}
 */
export function rawRGBA(src) {
  const ctx = typeof src.getContext === 'function' ? src.getContext('2d') : src;
  const canvas = ctx.canvas;
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: id.data };
}

/**
 * 取**去掉 alpha** 的 RGB 字节（`rgb24` 布局，给 ffmpeg 管道与哈希用）。
 *
 * 透明像素按「与黑底合成」处理（`source-over` 到黑底），
 * 因为成片没有 alpha 通道 —— 这一步必须显式，不能靠丢弃第 4 字节。
 * @param {any} src `Canvas` 或 `CanvasRenderingContext2D`
 * @returns {Buffer} 长度 = `width*height*3`
 */
export function rawRGB(src) {
  const { width, height, data } = rawRGBA(src);
  const out = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    const a = data[i + 3];
    if (a === 255) {
      out[o] = data[i];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i + 2];
    } else {
      // 非预乘 RGBA 与不透明黑底合成：c' = c * a/255
      const f = a / 255;
      out[o] = Math.round(data[i] * f);
      out[o + 1] = Math.round(data[i + 1] * f);
      out[o + 2] = Math.round(data[i + 2] * f);
    }
  }
  return out;
}

/**
 * 断言一份 rgb24 buffer 能直接喂给 ffmpeg。
 * @param {Buffer|Uint8Array} buf
 * @param {number} w
 * @param {number} h
 * @param {string} [what]
 * @throws {Error}
 */
export function assertRgb24Buffer(buf, w, h, what = 'frame buffer') {
  const want = w * h * 3;
  if (!buf || buf.length !== want) {
    throw new Error(
      `${what} 长度断言失败：期望 ${want} 字节（${w}×${h}×3，rgb24），实际 ${buf ? buf.length : '(空)'}\n` +
        `  hint: 长度不对喂进 ffmpeg 就是花屏。检查是不是漏了 alpha 通道或传了 RGBA`,
    );
  }
}

/**
 * 把非预乘 RGBA 写回 canvas。
 * @param {any} dst `Canvas` 或 `CanvasRenderingContext2D`
 * @param {RawImage} img
 */
export function putRGBA(dst, img) {
  const ctx = typeof dst.getContext === 'function' ? dst.getContext('2d') : dst;
  const canvas = ctx.canvas;
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/**
 * 逐字节比较两张图，返回差异摘要。
 * 这就是 ⭐「同帧双渲比对」的核心：**不要只说 differs**，要说清差在哪
 * （施工说明 §7.2 的好例子）。
 * @param {RawImage} a
 * @param {RawImage} b
 * @returns {{equal: boolean, bbox: ?{x0: number, y0: number, x1: number, y1: number},
 *            firstDiff: ?{x: number, y: number, a: [number, number, number, number], b: [number, number, number, number]},
 *            pixels: number, maxDelta: number}}
 */
export function diffRGBA(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`diffRGBA 尺寸不一致：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const { width, height } = a;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let first = null;
  let pixels = 0;
  let maxDelta = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d0 = Math.abs(a.data[i] - b.data[i]);
      const d1 = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const d2 = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const d3 = Math.abs(a.data[i + 3] - b.data[i + 3]);
      const d = Math.max(d0, d1, d2, d3);
      if (d === 0) continue;
      pixels++;
      if (d > maxDelta) maxDelta = d;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (first === null) {
        first = {
          x,
          y,
          a: [a.data[i], a.data[i + 1], a.data[i + 2], a.data[i + 3]],
          b: [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]],
        };
      }
    }
  }

  return {
    equal: pixels === 0,
    bbox: pixels === 0 ? null : { x0, y0, x1, y1 },
    firstDiff: first,
    pixels,
    maxDelta,
  };
}

/**
 * 把 `diffRGBA()` 的结果渲染成可读的多行文本（差异区域坐标 + 首个差异像素）。
 * @param {ReturnType<typeof diffRGBA>} d
 * @param {string} [what] 前缀，如 `frame 2769`
 * @returns {string} 相等时返回空串
 */
export function describeDiff(d, what = 'image') {
  if (d.equal) return '';
  const bb = /** @type {{x0:number,y0:number,x1:number,y1:number}} */ (d.bbox);
  const fd = /** @type {{x:number,y:number,a:number[],b:number[]}} */ (d.firstDiff);
  return (
    `${what} 两次渲染不一致：bbox (x0=${bb.x0}, y0=${bb.y0}, x1=${bb.x1}, y1=${bb.y1})\n` +
    `  首个差异像素 (${fd.x}, ${fd.y})：A=(${fd.a[0]},${fd.a[1]},${fd.a[2]},${fd.a[3]}) ` +
    `B=(${fd.b[0]},${fd.b[1]},${fd.b[2]},${fd.b[3]})\n` +
    `  ${d.pixels} 个像素不同；单通道最大差 ${d.maxDelta}`
  );
}

/**
 * ⭐ 同帧双渲比对的断言版本。
 * @param {RawImage} a
 * @param {RawImage} b
 * @param {string} [what]
 * @throws {Error}
 */
export function assertSame(a, b, what = 'image') {
  const d = diffRGBA(a, b);
  if (!d.equal) throw new Error(describeDiff(d, what));
  return d;
}
