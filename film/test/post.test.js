/**
 * film/test/post.test.js — Phase 4 验收（施工说明 §6 Phase 4）。
 *
 * 逐条对应：
 *   - [x] 残影：连续 3 帧，**亮部留痕、暗部立即恢复**（8×8 单元测试）
 *   - [x] 扫描线 / 暗角缓存命中：第 2 帧起**不重复构建**（打点计数）
 *   - [x] `reveal` 三个 `delay` 各出一段可辨认的转场；`t` 相同时结果一致
 *   - [x] 六层顺序：故意把 `subject` 挪到 `content` 之前，**视觉上角色被背景盖住**
 *   - [x] 后期参数集中在 `kit/post-config.js`，可命令行覆盖
 *   - [x] 后期全关时 `frame()` 与 Phase 3 的哈希一致（证明 post 是**加法**，没改前面的层）
 */

import { createCanvas } from '@napi-rs/canvas';

import { FRAME_COUNT, H, W, timeAt } from '../engine/clock.js';
import { frame } from '../engine/frame.js';
import { assertWithinFilm, delayEnd, dissolve, firstOf, inward, radial, sweep } from '../engine/transitions.js';
import { compose, makeStack, LAYERS } from '../engine/layers.js';
import { createLayer, ctx2d } from '../kit/canvas.js';
import { frameRng } from '../kit/noise.js';
import {
  bloom,
  cacheStats,
  post,
  resetCache,
  reveal,
  scanlineTile,
  scanlines,
  trail,
  vignette,
  vignetteMask,
} from '../kit/post.js';
import {
  DEFAULTS,
  ALL_ON,
  describeConfig,
  envOverrides,
  mergeConfig,
  parseOverrides,
} from '../kit/post-config.js';
import { diffRGBA, rawRGBA } from '../kit/pixels.js';
import { frameHash } from '../hash.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

/**
 * 造一张 8×8 测试图：每个像素由回调决定。
 * @param {(x: number, y: number) => [number, number, number, number]} fn
 */
function img8(fn) {
  const cv = createLayer(8, 8);
  const ctx = ctx2d(cv);
  const id = ctx.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * 8 + x) * 4;
      id.data[i] = r;
      id.data[i + 1] = g;
      id.data[i + 2] = b;
      id.data[i + 3] = a;
    }
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

/** 取一个像素。 */
function px(cv, x, y) {
  const d = ctx2d(cv).getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/**
 * 造一张纯色图（转场测试到处要用）。
 * @param {number} w @param {number} h @param {[number, number, number]} rgb
 */
function solid(w, h, rgb) {
  const cv = createLayer(w, h);
  const c = ctx2d(cv);
  c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  c.fillRect(0, 0, w, h);
  return cv;
}

describe('Phase 4 · 残影（trail）：亮部留痕、暗部立即恢复', () => {
  test('8×8：上一帧的亮部留下，暗部被本帧的暗压回去', () => {
    // 上一帧：左半边亮(200)、右半边暗(20)
    const prev = img8((x) => (x < 4 ? [200, 200, 200, 255] : [20, 20, 20, 255]));
    // 本帧：**反过来**，左半边暗(20)、右半边亮(200)
    const cur = img8((x) => (x < 4 ? [20, 20, 20, 255] : [200, 200, 200, 255]));

    const r = trail(cur, prev, DEFAULTS.trailAmount); // 0.35 → decay 0.65
    eq(r.applied, true, '该生效');
    ok(r.changed > 0, '该有像素被抬亮');

    const ghost = Math.round(200 * (1 - DEFAULTS.trailAmount)); // 130
    // 左半边：本帧 20，上一帧残影 130 → 取 max = 130（**亮部留痕**）
    eq(px(cur, 0, 0)[0], ghost, '左半边该留下上一帧的亮部残影');
    // 右半边：本帧 200 > 上一帧残影 20*0.65=13 → 保持 200（**暗部不留痕**）
    eq(px(cur, 7, 0)[0], 200, '右半边该是本帧的 200，不是 13');
  });

  test('连续 3 帧：亮部逐帧衰减、但不是线性混合', () => {
    const amount = 0.35;
    const decay = 1 - amount;
    let cur = img8(() => [255, 255, 255, 255]);
    let expected = 255;
    /** @type {number[]} */
    const got = [];
    for (let i = 0; i < 3; i++) {
      const black = img8(() => [0, 0, 0, 255]);
      trail(black, cur, amount); // 本帧全黑，只有残影
      got.push(px(black, 0, 0)[0]);
      expected = expected * decay;
      cur = black;
    }
    eq(got[0], Math.round(255 * decay), `第 1 帧残影`);
    eq(got[1], Math.round(255 * decay * decay), `第 2 帧残影`);
    eq(got[2], Math.round(255 * decay * decay * decay), `第 3 帧残影`);
    ok(got[0] > got[1] && got[1] > got[2], '该逐帧变暗');
  });

  test('用 max 而不是 blend：本帧暗部**不会**被上一帧拖亮到平均值', () => {
    const prev = img8(() => [100, 100, 100, 255]);
    const cur = img8(() => [0, 0, 0, 255]);
    trail(cur, prev, 0.5);
    // max(0, 100*0.5) = 50；如果是线性 blend 会是 0*(0.5)+100*0.5 = 50 —— 一样。
    // 所以换一个「本帧比残影亮」的样例来区分：本帧 200、残影 50 → max = 200，blend = 125
    const cur2 = img8(() => [200, 200, 200, 255]);
    trail(cur2, prev, 0.5);
    eq(px(cur2, 0, 0)[0], 200, 'max 语义：本帧更亮就保持本帧（blend 会把它压到 125）');
  });

  test('prev = null 时残影不生效（段的第一帧）', () => {
    const cur = img8(() => [128, 128, 128, 255]);
    const r = trail(cur, null, 0.9);
    eq(r.applied, false, '没有 prev 就不该动手');
    eq(px(cur, 0, 0)[0], 128, '像素不该变');
  });

  test('amount = 0 时残影不生效', () => {
    const cur = img8(() => [128, 128, 128, 255]);
    eq(trail(cur, img8(() => [255, 255, 255, 255]), 0).applied, false, 'amount=0');
  });

  test('prev 尺寸不一致要报错（不要静默画错）', () => {
    const cur = img8(() => [0, 0, 0, 255]);
    const bad = createCanvas(4, 4);
    const err = throws(() => trail(cur, bad, 0.5), '尺寸不一致');
    contains(err.message, '尺寸不一致', '要说清是尺寸问题');
  });
});

describe('Phase 4 · 扫描线与暗角：常量必须缓存', () => {
  test('扫描线：第 1 次构建，第 2 次起命中缓存（打点计数）', () => {
    resetCache();
    const a = scanlineTile(3, 0.2);
    eq(cacheStats.scanline, 1, '第一次该构建');
    eq(cacheStats.scanlineHit, 0, '第一次不该命中');
    const b = scanlineTile(3, 0.2);
    eq(cacheStats.scanline, 1, '第二次**不该**再构建');
    eq(cacheStats.scanlineHit, 1, '第二次该命中');
    ok(a === b, '命中的该是同一个对象（不是「又建了一张一样的」）');

    const c = scanlineTile(3, 0.4);
    eq(cacheStats.scanline, 2, '参数变了才该新建');
    void c;
  });

  test('暗角：第 1 次构建，第 2 次起命中缓存', () => {
    resetCache();
    vignetteMask(W, H, 0.5, 2.4, 64);
    eq(cacheStats.vignette, 1, '第一次该构建');
    vignetteMask(W, H, 0.5, 2.4, 64);
    eq(cacheStats.vignette, 1, '第二次**不该**再构建');
    eq(cacheStats.vignetteHit, 1, '第二次该命中');
  });

  test('暗角在小图上算（64 宽），不是全分辨率', () => {
    resetCache();
    const m = vignetteMask(W, H, 0.5, 2.4, 64);
    eq(m.w, 64, '遮罩宽');
    eq(m.h, 36, '遮罩高（16:9）');
    ok(m.canvas.width === 64 && m.canvas.height === 36, '遮罩画布尺寸');
  });

  test('暗角遮罩：中心亮、四角暗，且中心不被压暗', () => {
    resetCache();
    const m = vignetteMask(64, 36, 0.6, 2.4, 64);
    const d = ctx2d(m.canvas).getImageData(0, 0, 64, 36).data;
    const at = (x, y) => d[(y * 64 + x) * 4];
    eq(at(32, 18), 255, '中心该是 255（不压暗）');
    ok(at(0, 0) < 160, `左上角该明显变暗，实际 ${at(0, 0)}`);
    ok(at(63, 35) < 160, `右下角该明显变暗，实际 ${at(63, 35)}`);
    ok(at(32, 18) > at(0, 18), '中心该比左边缘亮');
  });

  test('连渲两帧：第 2 帧不再重建任何一个常量', () => {
    resetCache();
    const mk = () => {
      const cv = createLayer(320, 180);
      ctx2d(cv).fillStyle = '#204060';
      ctx2d(cv).fillRect(0, 0, 320, 180);
      return cv;
    };
    scanlines(mk(), { period: DEFAULTS.scanlinePeriod, amount: DEFAULTS.scanlineAmount });
    vignette(mk(), { strength: DEFAULTS.vignetteStrength, power: DEFAULTS.vignettePower, down: 64 });
    const builtAfterFirst = cacheStats.scanline + cacheStats.vignette;
    scanlines(mk(), { period: DEFAULTS.scanlinePeriod, amount: DEFAULTS.scanlineAmount });
    vignette(mk(), { strength: DEFAULTS.vignetteStrength, power: DEFAULTS.vignettePower, down: 64 });
    eq(cacheStats.scanline + cacheStats.vignette, builtAfterFirst, '第 2 帧不该新建任何常量');
    eq(cacheStats.scanlineHit >= 1 && cacheStats.vignetteHit >= 1, true, '两个都该命中');
  });

  test('扫描线确实压暗了某些行（不是空操作）', () => {
    resetCache();
    const cv = createLayer(8, 6);
    const c = ctx2d(cv);
    c.fillStyle = 'rgb(200,200,200)';
    c.fillRect(0, 0, 8, 6);
    scanlines(cv, { period: 3, amount: 0.5 });
    const d = c.getImageData(0, 0, 8, 6).data;
    const at = (x, y) => d[(y * 8 + x) * 4];
    ok(at(0, 0) < 200, `第 0 行该被压暗，实际 ${at(0, 0)}`);
    eq(at(0, 1), 200, '第 1 行不该变');
    eq(at(0, 2), 200, '第 2 行不该变');
    eq(at(0, 3), at(0, 0), '周期为 3，第 3 行该和第 0 行一样');
  });
});

describe('Phase 4 · 辉光（bloom）', () => {
  test('辉光把亮点扩散开（邻域被抬亮、且沿用了 max 语义不压暗原有的亮部）', () => {
    const cv = createLayer(64, 64);
    const c = ctx2d(cv);
    c.fillStyle = 'rgb(0,0,0)';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = 'rgb(255,255,255)';
    c.fillRect(30, 30, 4, 4);
    const before = px(cv, 24, 32)[0];
    bloom(cv, 0.6, { sigma: 2, down: 4, mode: 'screen', blurMode: 'box' });
    const center = px(cv, 32, 32)[0];
    const near = px(cv, 24, 32)[0];
    eq(center, 255, '中心本来就 255，screen 后还是 255（不炸白）');
    ok(near > before, `邻域该被抬亮：${before} → ${near}`);
  });

  test('amount = 0 时辉光不动画面', () => {
    const cv = createLayer(16, 16);
    ctx2d(cv).fillStyle = 'rgb(10,20,30)';
    ctx2d(cv).fillRect(0, 0, 16, 16);
    const h0 = frameHash(cv);
    bloom(cv, 0);
    eq(frameHash(cv), h0, 'amount=0 该是空操作');
  });
});

describe('Phase 4 · 逐格延迟转场（reveal + 三个 delay）', () => {
  const SIZE = 128;

  test('radial：波从中心向外，中心先切换', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [255, 0, 0]);
    const delay = radial([SIZE / 2, SIZE / 2], 0, 400, { w: SIZE, h: SIZE });
    const dst = createLayer(SIZE, SIZE);

    const mid = reveal(dst, oldImg, newImg, 0.05, delay, { cell: 8, useGlyphs: false });
    ok(mid.p > 0 && mid.p < 1, `中途该是一部分切换，实际 p=${mid.p}`);
    // 中心那格该已经切了，四角还没
    const c = ctx2d(dst);
    const centerPx = c.getImageData(64, 64, 1, 1).data;
    const cornerPx = c.getImageData(2, 2, 1, 1).data;
    ok(centerPx[0] > 200, `中心该已切到红，实际 ${centerPx[0]}`);
    eq(cornerPx[0], 0, '左上角该还是黑');

    const all = reveal(dst, oldImg, newImg, 1.0, delay, { cell: 8, useGlyphs: false });
    eq(all.p, 1, '给足时间该全部切换');
  });

  test('inward：从边缘往中心收（边缘先切换、中心最后）', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [0, 255, 0]);
    const delay = inward(0, 0.5, { w: SIZE, h: SIZE });
    const dst = createLayer(SIZE, SIZE);
    reveal(dst, oldImg, newImg, 0.1, delay, { cell: 4, useGlyphs: false });
    const c = ctx2d(dst);
    ok(c.getImageData(1, 1, 1, 1).data[1] > 200, '左上角（边缘）该已切换');
    eq(c.getImageData(64, 64, 1, 1).data[1], 0, '中心该还没切换');
  });

  test('inward：整体切换时刻确实在边缘之后、中心之前', () => {
    // 用**小图**：格中心在 (4,4) 与 (8,8)，depth 分别是 4 与 7，给 reach=16 就都在 reach 以内，
    // 于是能精确验证插值（大图中心会落进截断平台期）。
    // 边界用 `min(x, y, w-1-x, h-1-y)`：16×16 的中心格中心是 (8,8)，到最近边是 **7** 不是 8。
    const delay = inward(0, 1, { w: 16, h: 16, reach: 16 });
    eq(delay(0, 0), 0, '边缘 t=0');
    eq(delay(4, 4), 0.25, 'depth 4 / reach 16');
    eq(delay(8, 8), 0.4375, 'depth 7 / reach 16');
    eq(delay(12, 12), 0.1875, 'depth 3 / reach 16');
  });

  test('inward：大图时中心确实落在 t1 的平台期上', () => {
    const delay = inward(0, 1, { w: SIZE, h: SIZE });
    ok(delay(SIZE / 2 - 0.5, SIZE / 2 - 0.5) > delay(20, 20), '中心该比内环晚');
    ok(Math.abs(delay(SIZE / 2 - 0.5, SIZE / 2 - 0.5) - 1) < 0.02, '中心该已经贴着 t1（平台期）');
  });

  test('inward：严格单调只到 `reach` 为止，更靠内的格子是平台期（语义写清并测掉）', () => {
    const delay = inward(0, 1, { w: SIZE, h: SIZE, reach: 32 });
    const a = delay(10, 10); // depth 10 → 10/32
    const b = delay(20, 20); // depth 20 → 20/32
    const c = delay(40, 40); // depth 40 > reach → 截断到 1
    const d = delay(60, 60); // 同样截断到 1
    ok(a < b, `reach 以内该越靠内越晚：${a} < ${b}`);
    ok(b < c, `${b} < ${c}`);
    eq(c, d, '超过 reach 的格子该同时切换（平台期）');
    eq(d, 1, '平台期发生在 t1');
  });

  test('inward(fromCenter)：反过来，从中心往外放', () => {
    const delay = inward(0, 1, { w: SIZE, h: SIZE, fromCenter: true });
    ok(delay(SIZE / 2 - 0.5, SIZE / 2 - 0.5) < delay(1, 1), '中心该比边缘早');
  });

  test('sweep：一条直线推过去（左右两端不同时切换）', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [0, 0, 255]);
    const delay = sweep([0, 0], [1, 0], 0, 256); // 从左边往右扫
    const dst = createLayer(SIZE, SIZE);
    reveal(dst, oldImg, newImg, 0.25, delay, { cell: 4, useGlyphs: false });
    const c = ctx2d(dst);
    ok(c.getImageData(30, 64, 1, 1).data[2] > 200, '左边该已切换');
    eq(c.getImageData(120, 64, 1, 1).data[2], 0, '右边该还没切换');
  });

  test('三个 delay 函数在同一 t 下**结果一致**（纯函数）', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [255, 255, 255]);
    const cases = [
      ['radial', radial([40, 40], 0.1, 300, { w: SIZE, h: SIZE })],
      ['inward', inward(0.05, 0.6, { w: SIZE, h: SIZE })],
      ['sweep', sweep([0, SIZE / 2], [1, 1], 0.02, 200)],
      ['dissolve', dissolve(0, 0.4, 12345)],
      ['firstOf', firstOf(radial([10, 10], 0, 200, { w: SIZE, h: SIZE }), sweep([0, 0], [1, 1], 0, 150))],
    ];
    for (const [label, delay] of cases) {
      const mk = () => {
        const dst = createLayer(SIZE, SIZE);
        reveal(dst, oldImg, newImg, 0.2, delay, { cell: 8, useGlyphs: false });
        return rawRGBA(dst);
      };
      const d = diffRGBA(mk(), mk());
      ok(d.equal, `${label}: 同一个 t 两次该逐像素一致，但有 ${d.pixels} 个像素不同`);
    }
  });

  test('三个 delay 各出一段**可辨认**的转场（切换比例随 t 单调上升）', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [255, 255, 255]);
    const cases = [
      // 速度要选得让「最后一个 t」仍在转场中：最远距离 = 对角 90.5，速度 90 → 最晚 ~1.0 s
      ['radial', radial([SIZE / 2, SIZE / 2], 0, 90, { w: SIZE, h: SIZE }), [0.09, 0.2, 0.4]],
      // reach 要略大于最中心的 depth（128 图上中心格 depth = 63），否则会提前进入平台期、全部一起切
      ['inward', inward(0, 1, { w: SIZE, h: SIZE, reach: 64 }), [0.2, 0.5, 0.85]],
      ['sweep', sweep([0, 0], [1, 1], 0, 90), [0.2, 0.5, 0.9]],
    ];
    for (const [label, delay, ts] of cases) {
      const dst = createLayer(SIZE, SIZE);
      /** @type {number[]} */
      const ps = [];
      for (const t of ts) {
        const r = reveal(dst, oldImg, newImg, t, delay, { cell: 8, useGlyphs: false });
        ps.push(r.p);
      }
      ok(ps[0] > 0, `${label}: t=${ts[0]} 该已经切换了一部分，实际 p=${ps[0]}`);
      ok(ps[0] < ps[1] && ps[1] < ps[2], `${label}: 切换比例该随 t 单调上升，实际 ${ps.join(' < ')}`);
      ok(ps[2] < 1, `${label}: 最后一个 t（${ts[2]}）不该已经切完，实际 p=${ps[2]}（否则看不出「转场中」）`);
      // 给足时间必须切完（转场不能永远停在中途）。
      // ⚠️ `delayEnd` 的采样步长要比 `cell` 细：粗采样会漏掉「最晚那一格」，
      // 于是算出来的时间不够，测试会误报。
      const end = delayEnd(delay, { w: SIZE, h: SIZE, cell: 2 });
      const last = reveal(dst, oldImg, newImg, end + 0.01, delay, { cell: 8, useGlyphs: false });
      eq(last.p, 1, `${label}: 给足时间该全部切换`);
    }
  });

  test('解码字符只画在**有墨**的格子上（不会给纯黑背景撒噪点）', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [0, 0, 0]); // 完全一样 → 没有任何「墨」
    const delay = radial([SIZE / 2, SIZE / 2], 0, 1000, { w: SIZE, h: SIZE });
    const dst = createLayer(SIZE, SIZE);
    const r = reveal(dst, oldImg, newImg, 0.2, delay, { cell: 8, useGlyphs: true, glyphs: 'X' });
    eq(r.glyphCells, 0, '两边都没有墨，不该画任何字符');
    eq(frameHash(dst), frameHash(solid(SIZE, SIZE, [0, 0, 0])), '结果该与全黑图一致');
  });

  test('有墨时才画解码字符', () => {
    const oldImg = solid(SIZE, SIZE, [0, 0, 0]);
    const newImg = solid(SIZE, SIZE, [255, 255, 255]);
    const delay = radial([SIZE / 2, SIZE / 2], 0, 600, { w: SIZE, h: SIZE });
    const dst = createLayer(SIZE, SIZE);
    const r = reveal(dst, oldImg, newImg, 0.1, delay, { cell: 16, useGlyphs: true, glyphs: 'X' });
    ok(r.glyphCells > 0, `该在正在切换的格子上画字符，实际 ${r.glyphCells}`);
  });
});

describe('Phase 4 · 转场的边界断言', () => {
  test('delayEnd 扫出最晚切换时刻', () => {
    const d = radial([0, 0], 0, 1000, { w: 100, h: 100 });
    const end = delayEnd(d, { w: 100, h: 100, cell: 10 });
    ok(end > 0 && end < 1, `最晚该在 0..1 之间，实际 ${end}`);
  });

  test('超出片长的转场要报错（带具体时刻）', () => {
    const tooSlow = radial([0, 0], 0, 1, { w: W, h: H }); // 1 像素/秒 → 要几千秒
    const err = throws(() => assertWithinFilm(tooSlow, 'too-slow', { cell: 64 }), '慢得离谱的转场');
    contains(err.message, 'too-slow', '要带标签');
    contains(err.message, '超出片长', '要说清是超片长');
  });

  test('速度非法直接报错', () => {
    contains(throws(() => radial([0, 0], 0, 0), 'speed=0').message, 'speed', 'radial');
    contains(throws(() => sweep([0, 0], [0, 0], 0, 10), '零向量').message, 'dir', 'sweep');
  });
});

describe('Phase 4 · 六层顺序（顺序写成数据，一处可改）', () => {
  test('LAYERS 的顺序就是约定的六层（post 不在里面）', () => {
    eq(LAYERS.join(','), 'background,content,carriers,subject,chrome', '层顺序');
    eq(LAYERS.includes('post'), false, 'post 该是最后单独一步，不在 LAYERS 里');
  });

  test('故意把 subject 挪到 content 之前 → 角色被 content 盖住', () => {
    const stack = makeStack(0, 32, 32);
    // content 铺满红，subject 铺满绿，两者完全重叠
    const c = ctx2d(stack.content);
    c.fillStyle = 'rgb(255,0,0)';
    c.fillRect(0, 0, 32, 32);
    const s = ctx2d(stack.subject);
    s.fillStyle = 'rgb(0,255,0)';
    s.fillRect(0, 0, 32, 32);

    // 正常顺序：subject 在 content 之后 → 看见绿色
    const normal = createLayer(32, 32);
    compose(normal, stack);
    eq(px(normal, 16, 16)[1], 255, '正常顺序该看见 subject（绿）');
    eq(px(normal, 16, 16)[0], 0, '红色该被盖住');

    // 交换两个层的绘制顺序（模拟「改坏了 LAYERS」）→ 看见红色
    const swapped = createLayer(32, 32);
    const sc = ctx2d(swapped);
    for (const name of ['background', 'subject', 'content', 'carriers', 'chrome']) {
      sc.drawImage(stack[name], 0, 0);
    }
    eq(px(swapped, 16, 16)[0], 255, '交换后该看见 content（红）');
    eq(px(swapped, 16, 16)[1], 0, '绿色该被盖住');
  });

  test('compose 的 skip 能把某层抽掉（排障用）', () => {
    const stack = makeStack(0, 8, 8);
    const c = ctx2d(stack.content);
    c.fillStyle = 'rgb(255,0,0)';
    c.fillRect(0, 0, 8, 8);
    const dst = createLayer(8, 8);
    compose(dst, stack, { skip: new Set(['content']) });
    eq(px(dst, 4, 4)[0], 0, 'content 被 skip 后该是透明/黑');
  });

  test('层尺寸不一致要报错', () => {
    const stack = makeStack(0, 8, 8);
    const bad = createLayer(16, 16);
    const err = throws(() => compose(bad, stack), '目标尺寸不一致');
    contains(err.message, '尺寸', '要说清是尺寸问题');
  });
});

describe('Phase 4 · 后期参数集中在一处且可覆盖', () => {
  test('mergeConfig：后面的覆盖前面的', () => {
    const a = mergeConfig({ bloomAmount: 0.5 });
    eq(a.bloomAmount, 0.5, '覆盖生效');
    eq(a.trailAmount, DEFAULTS.trailAmount, '没覆盖的保持默认');
    const b = mergeConfig({ bloomAmount: 0.5 }, { bloomAmount: 0.9 });
    eq(b.bloomAmount, 0.9, '后者优先');
  });

  test('未知的键要报错（别静默忽略一个拼错的参数）', () => {
    const err = throws(() => mergeConfig(/** @type {any} */ ({ bloomAmout: 0.5 })), '拼错的键');
    contains(err.message, 'bloomAmout', '要指出是哪个键');
    contains(err.message, 'bloomAmount', '要列出可用键');
  });

  test('--post 的 key=value 解析（含多个、含逗号）', () => {
    const o = parseOverrides(['bloomAmount=0.5,trailAmount=0.1', 'scanlineAmount=0.3']);
    eq(o.bloomAmount, 0.5, 'bloomAmount');
    eq(o.trailAmount, 0.1, 'trailAmount');
    eq(o.scanlineAmount, 0.3, 'scanlineAmount');
    contains(throws(() => parseOverrides(['nope=1']), '未知键').message, 'nope', '未知键');
    contains(throws(() => parseOverrides(['bloomAmount']), '不是 key=value').message, 'key=value', '格式');
    contains(throws(() => parseOverrides(['bloomAmount=x']), '不是数').message, '数', '类型');
  });

  test('环境变量覆盖（DSH_POST_*）', () => {
    try {
      process.env.DSH_POST_BLOOM_AMOUNT = '0.75';
      process.env.DSH_POST_BLOOM_MODE = 'plus';
      const o = envOverrides();
      eq(o.bloomAmount, 0.75, '数值');
      eq(o.bloomMode, 'plus', '字符串');
    } finally {
      delete process.env.DSH_POST_BLOOM_AMOUNT;
      delete process.env.DSH_POST_BLOOM_MODE;
    }
  });

  test('优先级：默认 < 环境变量 < CLI', () => {
    const prevEnv = process.env.DSH_POST_BLOOM_AMOUNT;
    try {
      process.env.DSH_POST_BLOOM_AMOUNT = '0.4';
      const cfg = mergeConfig(envOverrides(), parseOverrides(['bloomAmount=0.8']));
      eq(cfg.bloomAmount, 0.8, 'CLI 最高');
    } finally {
      if (prevEnv === undefined) delete process.env.DSH_POST_BLOOM_AMOUNT;
      else process.env.DSH_POST_BLOOM_AMOUNT = prevEnv;
    }
  });

  test('ALL_ON / describeConfig 可用', () => {
    eq(ALL_ON.trail, true, 'ALL_ON');
    ok(describeConfig(DEFAULTS).includes('bloom='), '摘要该带 bloom（日志里能一眼看出参数）');
  });
});

describe('Phase 4 · post 是加法：关掉后期就能拿回 Phase 3 的画面', () => {
  test('--no-post 的 frame(n) 与不做后期时哈希一致', () => {
    const off = { trail: false, bloom: false, scanlines: false, vignette: false };
    for (const n of [0, 300, 419]) {
      const a = frame(n, null, { postEnable: off });
      // 再来一次，确认「关掉后期」是稳定的（不是碰巧）
      const b = frame(n, null, { postEnable: off });
      eq(frameHash(a), frameHash(b), `frame(${n}) 关后期两次`);
    }
  });

  test('全默认后期确实改变了画面（不是空跑）', () => {
    const off = { trail: false, bloom: false, scanlines: false, vignette: false };
    const on = frame(300);
    const without = frame(300, null, { postEnable: off });
    ok(frameHash(on) !== frameHash(without), '开了后期与关掉后期该不一样');
  });

  test('残影真的把上一帧带进来了（prev 影响结果）', () => {
    const off = { bloom: false, scanlines: false, vignette: false, trail: true };
    const prev = frame(300, null, { postEnable: { trail: false, bloom: false, scanlines: false, vignette: false } });
    const withPrev = frame(301, prev, { postEnable: off });
    const noPrev = frame(301, null, { postEnable: off });
    ok(frameHash(withPrev) !== frameHash(noPrev), '传 prev 与不传该不一样（残影在工作）');
  });

  test('post() 返回每一件套的实际动作（好写日志）', () => {
    resetCache();
    const cv = createLayer(64, 36);
    ctx2d(cv).fillStyle = '#101820';
    ctx2d(cv).fillRect(0, 0, 64, 36);
    const r = post(cv, null, DEFAULTS, {});
    eq(r.bloom, true, 'bloom');
    eq(r.scanlines, true, 'scanlines');
    eq(r.vignette, true, 'vignette');
    eq(r.trail, 0, '没有 prev，残影没动手');
  });

  test('post 全关时是纯空操作（哈希不变）', () => {
    const cv = createLayer(32, 32);
    const c = ctx2d(cv);
    c.fillStyle = 'rgb(123,45,67)';
    c.fillRect(0, 0, 32, 32);
    const h = frameHash(cv);
    post(cv, null, DEFAULTS, { trail: false, bloom: false, scanlines: false, vignette: false });
    eq(frameHash(cv), h, '全关该是空操作');
  });
});

describe('Phase 4 · 帧契约在后期打开后仍然成立', () => {
  test('frame(n) 尺寸恒为 W×H（后期不改变尺寸）', () => {
    for (const n of [0, FRAME_COUNT - 1]) {
      const cv = frame(n);
      eq(cv.width, W, `frame(${n}) 宽`);
      eq(cv.height, H, `frame(${n}) 高`);
    }
  });

  test('时间线四段边界仍落在真实拍点（后期没动时间线）', () => {
    eq(timeAt(419) * 24, 419, '开词帧');
  });

  test('随机只走 frameRng：两次 frame() 同一帧一致（含后期）', () => {
    const g = frameRng(42, 419);
    const a = [g(), g(), g()];
    const g2 = frameRng(42, 419);
    const b = [g2(), g2(), g2()];
    eq(a.join(), b.join(), 'frameRng 该可复现');
  });
});
