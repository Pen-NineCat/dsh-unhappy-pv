/**
 * film/test/kit.test.js — Phase 2 图形原语层的验收（施工说明 §6 Phase 2）。
 *
 * 验收清单（逐条对应）：
 *   - [x] `boxDownsample` 对拍：构造一张已知图，**手算**区域平均，逐像素一致
 *   - [x] `applyLut`：`lut[v] = 255 - v` 等价于反色，逐像素一致
 *   - [x] 同帧双渲对比：同一张合成图渲两次，`diffRGBA().bbox` 为 `null`
 *   - [x] 字形图集：同一字符两次烤图，位图 sha256 一致
 *   - [x] `toGray`：与 PIL 的权重/取整逐像素一致
 *   - [x] `bbox()` 是左闭右开（对齐 PIL `getbbox()`）
 *   - [x] 高斯模糊：核归一化、常量图不变、（对常量图）边缘不压黑
 */

import { createCanvas } from '@napi-rs/canvas';

import { frameHash } from '../hash.js';
import { createLayer, ctx2d, lighter, blend } from '../kit/canvas.js';
import { autoContrast, colorize, grayscale, toGray } from '../kit/color.js';
import { frameRng, hashNoise, noiseTile, rng, valueNoise } from '../kit/noise.js';
import { diffRGBA } from '../kit/pixels.js';
import {
  applyLut,
  bbox,
  bounds,
  boxDownsample,
  cloneRaw,
  convolve3x3,
  emptyRaw,
  gaussianBlur,
  gaussianKernel,
  invertLut,
  maxFilter,
  minFilter,
  readRaw,
  setAlpha,
  splitChannels,
  stats,
  stddev,
} from '../kit/raster.js';
import { cellMetrics, drawText, glyphAtlas, registerFont, resolveFontFile } from '../kit/text.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

/**
 * 造一张已知图：每个像素的 RGBA 由坐标算出来，**手算期望值**时不依赖被测代码。
 * @param {number} w @param {number} h
 * @returns {import('../kit/pixels.js').RawImage}
 */
function knownImage(w, h) {
  const img = emptyRaw(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = (x * 16) % 256;
      img.data[i + 1] = (y * 16) % 256;
      img.data[i + 2] = (x * y) % 256;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

describe('kit/raster · 🔴 boxDownsample（手算对拍）', () => {
  test('4×4 → 2×2：每个输出像素 = 对应 2×2 区域的算术平均', () => {
    const img = knownImage(4, 4);
    const out = boxDownsample(img, 2, 2);
    eq(out.width, 2, '输出宽');
    eq(out.height, 2, '输出高');

    // 手算：(0,0) 格 = 输入 (0,0),(1,0),(0,1),(1,1)
    /** @type {number[][]} */
    const expect = [];
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let y = oy * 2; y < oy * 2 + 2; y++) {
          for (let x = ox * 2; x < ox * 2 + 2; x++) {
            const i = (y * 4 + x) * 4;
            r += img.data[i];
            g += img.data[i + 1];
            b += img.data[i + 2];
          }
        }
        expect.push([Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)]);
      }
    }
    for (let k = 0; k < 4; k++) {
      const o = k * 4;
      eq(out.data[o], expect[k][0], `第 ${k} 格 R`);
      eq(out.data[o + 1], expect[k][1], `第 ${k} 格 G`);
      eq(out.data[o + 2], expect[k][2], `第 ${k} 格 B`);
      eq(out.data[o + 3], 255, `第 ${k} 格 A`);
    }
  });

  test('4×4 → 4×4（同尺寸）是恒等（每个输出格只含一个输入像素）', () => {
    const img = knownImage(4, 4);
    const out = boxDownsample(img, 4, 4);
    ok(new Uint8ClampedArray(img.data).every((v, i) => v === out.data[i]), '同尺寸应当是恒等');
  });

  test('5×5 → 2×2：源像素不重不漏（这才是「图像 → 字符网格」的正确性）', () => {
    const img = knownImage(5, 5);
    const out = boxDownsample(img, 2, 2);

    const xs = bounds(5, 2);
    const ys = bounds(5, 2);

    // 第一层：输出 = 它那一段的算术平均
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const [x0, x1] = xs[ox];
        const [y0, y1] = ys[oy];
        let r = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            r += img.data[(y * 5 + x) * 4];
            n++;
          }
        }
        eq(out.data[(oy * 2 + ox) * 4], Math.round(r / n), `格 (${ox},${oy}) 的 R，覆盖 x[${x0},${x1}) y[${y0},${y1})`);
      }
    }

    // 第二层（真正要守的不变量）：每个源像素**恰好落进一个**输出格。
    // 5 不能被 2 整除：如果边界写成 floor..ceil（0..3 / 3..5），
    // 第 3 列会被两格各算一次 —— 字会整体偏亮。这条断言就是拦它的。
    const seen = new Uint8Array(5 * 5);
    let total = 0;
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const [x0, x1] = xs[ox];
        const [y0, y1] = ys[oy];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = y * 5 + x;
            if (seen[idx]) throw new Error(`源像素 (${x},${y}) 被两个输出格用了`);
            seen[idx] = 1;
            total++;
          }
        }
      }
    }
    eq(total, 25, '覆盖的源像素数');
    ok(seen.every((v) => v === 1), '每个源像素都该被用到且只用到一次');
  });

  test('bounds() 的性质：相邻格首尾相接、铺满 [0, srcLen)', () => {
    for (const [sw, dw] of [
      [5, 2],
      [10, 3],
      [1920, 96],
      [1080, 54],
      [100, 100],
      [7, 7],
    ]) {
      const b = bounds(sw, dw);
      eq(b.length, dw, `格数 ${sw}→${dw}`);
      eq(b[0][0], 0, `${sw}→${dw} 起点`);
      eq(b[dw - 1][1], sw, `${sw}→${dw} 终点`);
      for (let i = 1; i < dw; i++) {
        eq(b[i][0], b[i - 1][1], `${sw}→${dw} 第 ${i} 格要与前一格接上`);
      }
      for (const [lo, hi] of b) ok(hi > lo, `${sw}→${dw} 每格至少一个源像素`);
    }
  });

  test('纯色图降采样后还是同一个色（不会被边缘权重带偏）', () => {
    const img = emptyRaw(9, 7);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 37;
      img.data[i + 1] = 200;
      img.data[i + 2] = 11;
      img.data[i + 3] = 255;
    }
    const out = boxDownsample(img, 3, 2);
    for (let i = 0; i < out.data.length; i += 4) {
      eq(out.data[i], 37, `R @${i}`);
      eq(out.data[i + 1], 200, `G @${i}`);
      eq(out.data[i + 2], 11, `B @${i}`);
    }
  });

  test('非整数目标尺寸直接报错（不要静默取整）', () => {
    const err = throws(() => boxDownsample(knownImage(4, 4), 2.5, 2), '小数目标宽');
    contains(err.message, '正整数', '要说清要求');
  });
});

describe('kit/raster · applyLut', () => {
  test('反色 LUT：逐像素 == 255 - v', () => {
    const img = knownImage(6, 5);
    const before = new Uint8ClampedArray(img.data);
    applyLut(img, invertLut());
    for (let i = 0; i < img.data.length; i += 4) {
      eq(img.data[i], 255 - before[i], `R @${i}`);
      eq(img.data[i + 1], 255 - before[i + 1], `G @${i}`);
      eq(img.data[i + 2], 255 - before[i + 2], `B @${i}`);
      eq(img.data[i + 3], before[i + 3], `alpha 不该被动 @${i}`);
    }
  });

  test('LUT 长度不是 256 就报错', () => {
    const err = throws(() => applyLut(knownImage(2, 2), new Uint8Array(16)), '短 LUT');
    contains(err.message, '256', '要说清要求');
  });

  test('三张不同的表可以分通道打', () => {
    const img = knownImage(3, 3);
    const zero = new Uint8Array(256);
    const full = new Uint8Array(256).fill(255);
    applyLut(img, zero, { r: full, g: full, b: full });
    for (let i = 0; i < img.data.length; i += 4) {
      eq(img.data[i], 255, `R @${i}`);
      eq(img.data[i + 1], 255, `G @${i}`);
      eq(img.data[i + 2], 255, `B @${i}`);
    }
  });
});

describe('kit/raster · 高斯模糊', () => {
  test('核归一化：和为 1', () => {
    for (const sigma of [0.6, 1, 2, 4, 8]) {
      const k = gaussianKernel(sigma);
      const sum = k.reduce((a, b) => a + b, 0);
      ok(Math.abs(sum - 1) < 1e-12, `sigma=${sigma} 的核和为 ${sum}`);
      eq(k.length % 2, 1, `sigma=${sigma} 的核长度是奇数`);
    }
  });

  test('纯色图模糊后不变（且边缘没被压黑）', () => {
    const img = emptyRaw(32, 24);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 90;
      img.data[i + 1] = 120;
      img.data[i + 2] = 150;
      img.data[i + 3] = 255;
    }
    const out = gaussianBlur(img, 3);
    for (let i = 0; i < out.data.length; i += 4) {
      eq(out.data[i], 90, `R @${i}（边缘延拓生效就不该变）`);
      eq(out.data[i + 1], 120, `G @${i}`);
      eq(out.data[i + 2], 150, `B @${i}`);
    }
  });

  test('sigma <= 0.5 时原样返回（不做无意义的卷积）', () => {
    const img = knownImage(8, 8);
    const out = gaussianBlur(img, 0.4);
    ok(out.data.every((v, i) => v === img.data[i]), '应当逐字节相同');
  });

  test('模糊会把极值往外摊（单点亮点扩散后峰值下降、邻域上升）', () => {
    const img = emptyRaw(21, 21);
    const c = (10 * 21 + 10) * 4;
    img.data[c] = 255;
    img.data[c + 1] = 255;
    img.data[c + 2] = 255;
    img.data[c + 3] = 255;
    const out = gaussianBlur(img, 2);
    ok(out.data[c] < 255, '中心峰值该下降');
    const nb = (10 * 21 + 11) * 4;
    ok(out.data[nb] > 0, '邻域该被点亮');
    ok(out.data[c] > out.data[nb], '中心该比邻域亮');
  });

  test('box 近似与真高斯到底差多少（**量化**，不是「差不多」）', () => {
    // 施工说明 §8 风险 5：`box: true` 是 O(1)/像素的逃生路线。
    // 但它是**近似**，所以要给一个可复核的误差上界，而不是口头保证。
    const img = knownImage(64, 48);
    for (const sigma of [2, 4]) {
      const exact = gaussianBlur(img, sigma);
      const approx = gaussianBlur(img, sigma, { box: true });
      let maxDelta = 0;
      let sum = 0;
      for (let i = 0; i < exact.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(exact.data[i + c] - approx.data[i + c]);
          if (d > maxDelta) maxDelta = d;
          sum += d;
        }
      }
      const n = (exact.data.length / 4) * 3;
      const meanDelta = sum / n;
      // 实测：sigma=2 时 max≈28 / mean≈2.0；sigma=4 时 max≈23 / mean≈1.8
      ok(maxDelta <= 48, `sigma=${sigma} 的单像素最大差 ${maxDelta} 该在 48 以内（64 级以内）`);
      ok(meanDelta <= 4, `sigma=${sigma} 的平均差 ${meanDelta.toFixed(2)} 该在 4 级以内`);
    }
  });
});

describe('kit/raster · 卷积与形态学', () => {
  test('3×3 全 1 核 = 均值滤波（scale 缺省 = 核和）', () => {
    const img = emptyRaw(5, 5);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 0;
      img.data[i + 3] = 255;
    }
    const c = (2 * 5 + 2) * 4;
    img.data[c] = 90;
    const out = convolve3x3(img, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    // 中心周围 9 格里只有中心是 90，其余 0 → 90/9 = 10
    eq(out.data[c], 10, '中心应当是 10');
  });

  test('Sobel 核（scale=1, offset=0）对平坦区域输出 0', () => {
    const img = emptyRaw(8, 8);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 128;
      img.data[i + 3] = 255;
    }
    const out = convolve3x3(img, [-1, 0, 1, -2, 0, 2, -1, 0, 1], { scale: 1 });
    for (let i = 0; i < out.data.length; i += 4) eq(out.data[i], 0, `R @${i}`);
  });

  test('max / min 滤波：极值按窗口扩散、窗口外不动', () => {
    const img = emptyRaw(5, 5);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 10;
      img.data[i + 3] = 255;
    }
    img.data[(2 * 5 + 2) * 4] = 250;
    const mx = maxFilter(img, 3);
    const mn = minFilter(img, 3);
    // (2,2) 在 (1,1)/(1,3)/(3,1)/(3,3) 的窗口里，(0,0) 不在任何含 (2,2) 的窗口里
    eq(mx.data[(2 * 5 + 2) * 4], 250, '中心自己');
    eq(mx.data[(1 * 5 + 1) * 4], 250, '(1,1) 的窗口含中心 → 250');
    eq(mx.data[(3 * 5 + 3) * 4], 250, '(3,3) 的窗口含中心 → 250');
    eq(mx.data[0], 10, '(0,0) 的窗口不含中心 → 仍是 10（这才是 max 与「全局最大」的区别）');
    eq(mn.data[(2 * 5 + 2) * 4], 10, 'min 把中心拉回 10');
    eq(mn.data[(1 * 5 + 1) * 4], 10, 'min 后 (1,1) 也是 10');

    const err = throws(() => maxFilter(img, 4), '偶数 size');
    contains(err.message, '正奇数', '要说清要求');
  });
});

describe('kit/raster · 统计与包围盒', () => {
  test('stats 用的是总体标准差（除以 n）', () => {
    const img = emptyRaw(4, 1);
    // R = 0,10,20,30 → mean 15，总体 std = sqrt(125)
    [0, 10, 20, 30].forEach((v, i) => {
      img.data[i * 4] = v;
      img.data[i * 4 + 3] = 255;
    });
    const st = stats(img);
    eq(st.mean[0], 15, '均值');
    ok(Math.abs(st.stddev[0] - Math.sqrt(125)) < 1e-9, `总体标准差，实际 ${st.stddev[0]}`);
    eq(st.min[0], 0, 'min');
    eq(st.max[0], 30, 'max');
  });

  test('stddev：纯色图 ≈ 0（「无空白帧」护栏的判据）', () => {
    const flat = emptyRaw(16, 16);
    for (let i = 0; i < flat.data.length; i += 4) {
      flat.data[i] = 7;
      flat.data[i + 1] = 7;
      flat.data[i + 2] = 7;
      flat.data[i + 3] = 255;
    }
    ok(stddev(flat) < 1e-6, '纯色图的 stddev 该是 0');

    const noisy = knownImage(16, 16);
    ok(stddev(noisy) > 10, '有内容的图 stddev 该明显大于 0');
  });

  test('bbox 是左闭右开（对齐 PIL getbbox）', () => {
    const img = emptyRaw(10, 10);
    // 画一个 2×3 的墨迹：x=3,4；y=5,6,7
    for (let y = 5; y <= 7; y++) {
      for (let x = 3; x <= 4; x++) img.data[(y * 10 + x) * 4 + 3] = 255;
    }
    const bb = bbox(img);
    eq(bb.x0, 3, 'x0');
    eq(bb.y0, 5, 'y0');
    eq(bb.x1, 5, 'x1（右开，所以 +1）');
    eq(bb.y1, 8, 'y1（下开，所以 +1）');
  });

  test('全空图的 bbox 是 null', () => {
    eq(bbox(emptyRaw(4, 4)), null, '空图');
  });

  test('setAlpha / splitChannels / 通道一致性', () => {
    const img = knownImage(4, 4);
    const alpha = cloneRaw(img);
    for (let i = 0; i < alpha.data.length; i += 4) alpha.data[i + 3] = 128;
    setAlpha(img, alpha);
    for (let i = 0; i < img.data.length; i += 4) eq(img.data[i + 3], 128, `alpha @${i}`);

    const ch = splitChannels(img);
    ok(ch.r.width === 4 && ch.r.height === 4, 'splitChannels 该返回同尺寸的单通道画布');
  });
});

describe('kit/color · 与 PIL 的权重一致', () => {
  test('toGray 用 (299,587,114)/1000 且**向下取整**', () => {
    const img = emptyRaw(3, 1);
    const cases = [
      [255, 0, 0],
      [0, 255, 0],
      [1, 1, 1],
    ];
    cases.forEach(([r, g, b], i) => {
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    });
    toGray(img);
    cases.forEach(([r, g, b], i) => {
      const want = Math.floor((r * 299 + g * 587 + b * 114) / 1000);
      eq(img.data[i * 4], want, `灰度 @${i}`);
    });
    eq(img.data[0], 76, '纯红 → 76（255*299/1000 = 76.245 → 向下取整）');
  });

  test('grayscale 不改原图（非原地版本）', () => {
    const img = knownImage(3, 3);
    const before = new Uint8ClampedArray(img.data);
    grayscale(img);
    ok(img.data.every((v, i) => v === before[i]), '原图该没被动');
  });

  test('colorize：0 → black，255 → white，中间线性', () => {
    const img = emptyRaw(3, 1);
    [0, 128, 255].forEach((v, i) => {
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    });
    colorize(img, [0, 0, 0], [255, 100, 0]);
    eq(img.data[0], 0, '黑端 R');
    eq(img.data[1], 0, '黑端 G');
    eq(img.data[2], 0, '黑端 B');
    eq(img.data[8], 255, '白端 R');
    eq(img.data[9], 100, '白端 G');
    eq(img.data[10], 0, '白端 B');
    eq(img.data[4], Math.round((128 * 255) / 255), '中值 R');
  });

  test('autoContrast 把灰度范围拉满，纯色图不动', () => {
    const img = emptyRaw(4, 1);
    [10, 20, 30, 40].forEach((v, i) => {
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    });
    autoContrast(img);
    eq(img.data[0], 0, '最小 → 0');
    eq(img.data[12], 255, '最大 → 255');

    const flat = emptyRaw(4, 4);
    for (let i = 0; i < flat.data.length; i += 4) {
      flat.data[i] = 33;
      flat.data[i + 3] = 255;
    }
    const before = new Uint8ClampedArray(flat.data);
    autoContrast(flat);
    ok(flat.data.every((v, i) => v === before[i]), '纯色图不该被拉伸');
  });
});

describe('kit/noise · 确定性（禁止 Math.random）', () => {
  test('同一个 seed 两次得到同一串', () => {
    const a = [...Array(8)].map(rng(12345));
    const b = [...Array(8)].map(rng(12345));
    ok(a.every((v, i) => v === b[i]), '同 seed 该完全一致');
    ok(a.every((v) => v >= 0 && v < 1), '值域该是 [0,1)');
  });

  test('不同 seed / 不同帧得到不同串', () => {
    const a = [...Array(8)].map(frameRng(7, 100));
    const b = [...Array(8)].map(frameRng(7, 101));
    const c = [...Array(8)].map(frameRng(8, 100));
    ok(a.join() !== b.join(), '不同帧该不同');
    ok(a.join() !== c.join(), '不同 seed 该不同');
  });

  test('hashNoise / valueNoise 与调用顺序无关', () => {
    eq(hashNoise(3, 4, 1, 9), hashNoise(3, 4, 1, 9), '同参数同值');
    ok(hashNoise(3, 4, 1, 9) !== hashNoise(4, 3, 1, 9), 'x/y 换了该不同');
    ok(valueNoise(1.5, 2.5, 3, 4) >= 0 && valueNoise(1.5, 2.5, 3, 4) < 1, '值域');
    eq(valueNoise(1.5, 2.5, 3, 4), valueNoise(1.5, 2.5, 3, 4), 'valueNoise 该是纯函数');
  });

  test('noiseTile 缓存命中：同参数第二次是同一个对象', () => {
    const a = noiseTile(8, 8, 12, 1, 5);
    const b = noiseTile(8, 8, 12, 1, 5);
    ok(a === b, '同参数该命中缓存（同一个 canvas 对象）');
    const c = noiseTile(8, 8, 12, 1, 6);
    ok(a !== c, '不同帧该是另一张瓦片');
  });
});

describe('kit/canvas · 合成算子', () => {
  test('lighter == 逐通道 max（残影的关键算子）', () => {
    const a = createLayer(4, 4);
    const b = createLayer(4, 4);
    const ca = ctx2d(a);
    const cb = ctx2d(b);
    ca.fillStyle = 'rgb(10,200,30)';
    ca.fillRect(0, 0, 4, 4);
    cb.fillStyle = 'rgb(120,50,90)';
    cb.fillRect(0, 0, 4, 4);
    lighter(a, b);
    const px = readRaw(a).data;
    eq(px[0], 120, 'R = max(10,120)');
    eq(px[1], 200, 'G = max(200,50)');
    eq(px[2], 90, 'B = max(30,90)');
  });

  test('blend(a, b, 0.5) 是线性混合', () => {
    const a = createLayer(2, 2);
    const b = createLayer(2, 2);
    ctx2d(a).fillStyle = 'rgb(0,0,0)';
    ctx2d(a).fillRect(0, 0, 2, 2);
    ctx2d(b).fillStyle = 'rgb(200,100,50)';
    ctx2d(b).fillRect(0, 0, 2, 2);
    blend(a, b, 0.5);
    const px = readRaw(a).data;
    eq(px[0], 100, 'R');
    eq(px[1], 50, 'G');
    eq(px[2], 25, 'B');
  });

  test('同帧双渲：整条合成链两次跑出来逐像素一致', () => {
    const render = () => {
      const cv = createLayer(64, 48);
      const c = ctx2d(cv);
      c.fillStyle = '#0b0f14';
      c.fillRect(0, 0, 64, 48);
      const g = frameRng(99, 42);
      for (let i = 0; i < 12; i++) {
        c.fillStyle = `rgb(${Math.floor(g() * 255)},${Math.floor(g() * 255)},${Math.floor(g() * 255)})`;
        c.fillRect(Math.floor(g() * 48), Math.floor(g() * 32), 12, 10);
      }
      c.font = '10px sans-serif';
      c.fillStyle = '#fff';
      c.fillText('unhappy', 4, 44);
      return readRaw(cv);
    };
    const d = diffRGBA(render(), render());
    ok(d.equal, `两次渲染该一致，但有 ${d.pixels} 个像素不同`);
    eq(d.bbox, null, 'bbox');
  });
});

describe('kit/text · 字形图集', () => {
  /** 找到 Consolas；找不到就让这个套件明确跳过（不假装通过）。 */
  function tryFont() {
    try {
      const p = resolveFontFile(['consola.ttf', 'Consolas.ttf']);
      return registerFont(p, 16, 'dsh-test');
    } catch {
      return null;
    }
  }

  test('同一字符两次烤图，位图 sha256 一致（冻结渲染结果）', () => {
    const font = tryFont();
    if (!font) {
      console.log('       （跳过：本机找不到 consola.ttf）');
      return;
    }
    const chars = 'ABCabc012 中文测试';
    const a = glyphAtlas(font, chars);
    const b = glyphAtlas(font, chars);
    eq(frameHash(a.canvas), frameHash(b.canvas), '两次烤图的图集位图');
    eq(a.cellW, b.cellW, 'cellW');
    eq(a.cellH, b.cellH, 'cellH');
    eq(a.ascent, b.ascent, 'ascent');
  });

  test('图集覆盖给定字符集，且空格是 blank', () => {
    const font = tryFont();
    if (!font) return;
    const atlas = glyphAtlas(font, 'AB ');
    ok(atlas.glyphs.has('A') && atlas.glyphs.has('B') && atlas.glyphs.has(' '), '该有三个字形');
    eq(/** @type {any} */ (atlas.glyphs.get(' ')).blank, true, '空格该是 blank');
    eq(/** @type {any} */ (atlas.glyphs.get('A')).blank, false, 'A 该有墨迹');
  });

  test('cellMetrics 来自图集，不是 measureText 的布局决策', () => {
    const font = tryFont();
    if (!font) return;
    const atlas = glyphAtlas(font, 'M');
    const m = cellMetrics(atlas);
    eq(m.w, atlas.cellW, 'w');
    eq(m.h, atlas.cellH, 'h');
    eq(m.ascent, atlas.ascent, 'ascent');
    ok(m.w > 0 && m.h > 0, '度量该是正数');
  });

  test('drawText：整数网格上画出墨迹；缺字形会记账', () => {
    const font = tryFont();
    if (!font) return;
    const atlas = glyphAtlas(font, 'ABC');
    const dst = createLayer(80, 24);
    const r = drawText(dst, atlas, { x: 2, y: 2 }, 'ABC', { color: '#ffffff' });
    eq(r.missing.length, 0, '不该缺字形');
    eq(r.drawn, 3, '该画了 3 个');
    eq(r.width, 3 * atlas.cellW, '前进宽度 = 3 格（整数网格）');
    const ink = bbox(readRaw(dst));
    ok(ink !== null, '该有墨迹');
    ok(ink.x0 >= 2 && ink.y0 >= 2, '墨迹不该跑到格子原点左上');

    const r2 = drawText(dst, atlas, { x: 2, y: 2 }, 'AZ', { color: '#ffffff', onMissing: 'skip' });
    eq(r2.missing.join(''), 'Z', 'Z 不在图集里，该被记账');
    const err = throws(
      () => drawText(dst, atlas, { x: 0, y: 0 }, 'Z', { onMissing: 'throw' }),
      '缺字形且要求抛错',
    );
    contains(err.message, 'Z', '要说清是哪个字形');
  });

  test('drawText 同一串画两次，结果逐像素一致', () => {
    const font = tryFont();
    if (!font) return;
    const atlas = glyphAtlas(font, 'unhappy 01');
    const mk = () => {
      const dst = createLayer(120, 24);
      drawText(dst, atlas, { x: 1, y: 1 }, 'unhappy 01', { color: '#ffcc00' });
      return readRaw(dst);
    };
    const d = diffRGBA(mk(), mk());
    ok(d.equal, `两次 drawText 该一致，但有 ${d.pixels} 个像素不同`);
  });
});
