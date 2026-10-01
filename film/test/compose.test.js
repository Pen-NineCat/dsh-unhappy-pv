/**
 * film/test/compose.test.js — Phase 6 验收（施工说明 §6 Phase 6）。
 *
 * 逐条对应：
 *   - [x] 截图贴入后，右侧的**位移/缩放确实作用在网页内容上**
 *   - [x] `LEAD` 表切换时刻两侧亮度按预期变化
 *   - [x] 缺一帧截图时**报错并指出帧号**
 *   - [x] 合成后的帧哈希清单**稳定**（同参数两次渲染一致）
 *   - [x] 额外：`LEAD` 表本身要过 ⭐ 时间线式的断言（覆盖 [0, 4741)、无空洞无重叠）
 *   - [x] 额外：截图尺寸 ≠ 目标矩形时必须报错（1:1 纪律）
 *   - [x] 额外：**没有猴补丁**（`kit` 上不该出现被塞进去的属性）
 */

import { createCanvas } from '@napi-rs/canvas';

import { FRAME_COUNT } from '../engine/clock.js';
import { applyTransform, breathing, createStaticTransform, keyframed, lerpTransform, normalizeTransform } from '../engine/camera.js';
import { leadAlphaAt } from '../compose/lead.js';
import { makeStack } from '../engine/layers.js';
import { createLayer, ctx2d } from '../kit/canvas.js';
import { diffRGBA, rawRGBA } from '../kit/pixels.js';
import { frameHash } from '../hash.js';
import { applySubjectLayer, makeSubjectLayer, overlayTracks } from '../compose/overlay.js';
import { LEAD_TABLE, NON_LEAD_ALPHA, TRACKS, assertLeadTable, leadSpanAt, tracksAt } from '../compose/lead.js';
import { assertShotsPresent, memoryShotSource, openShotSource } from '../compose/shots.js';
import * as kitCanvas from '../kit/canvas.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

/** 造一张纯色画布（当「截图」用）。 */
function solid(w, h, rgb, a = 255) {
  const cv = createLayer(w, h);
  const c = ctx2d(cv);
  c.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a / 255})`;
  c.fillRect(0, 0, w, h);
  return cv;
}

/** 取像素。 */
function px(cv, x, y) {
  const d = ctx2d(cv).getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/** 目标矩形（960×640 CSS px @dpr2 → 1920×1280 像素的截图）。 */
const RECT = { dx: 200, dy: 100, dw: 960, dh: 640 };
const DPR = 2;

/** 造一个「尺寸正确」的截图源。 */
function goodSource(n, track, rgb = /** @type {[number,number,number]} */ ([255, 255, 255])) {
  const key = `${n}|${track}`;
  return memoryShotSource(new Map([[key, solid(RECT.dw * DPR, RECT.dh * DPR, rgb)]]));
}

describe('Phase 6 · 镜头变换（camera）', () => {
  test('恒等变换不动画面', () => {
    const cv = solid(64, 64, [10, 20, 30]);
    const before = frameHash(cv);
    applyTransform(ctx2d(cv), normalizeTransform({}), { dx: 0, dy: 0, dw: 64, dh: 64 });
    eq(frameHash(cv), before, '恒等变换后该逐字节相同');
  });

  test('位移确实作用在内容上（贴一块方块，平移后位置改变）', () => {
    const mk = (tx, ty) => {
      const dst = createLayer(100, 100);
      const ctx = ctx2d(dst);
      applyTransform(ctx, createStaticTransform({ tx, ty }), { dx: 0, dy: 0, dw: 100, dh: 100 });
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(0, 0, 20, 20);
      return dst;
    };
    eq(px(mk(0, 0), 5, 5)[0], 255, '不平移时方块在左上');
    eq(px(mk(30, 0), 5, 5)[0], 0, '平移 30 后 (5,5) 该空了');
    eq(px(mk(30, 0), 35, 5)[0], 255, '平移 30 后方块该在 x=30..50');
  });

  test('缩放围绕 anchor：anchor=(0,0) 时左上角不动', () => {
    const dst = createLayer(100, 100);
    const ctx = ctx2d(dst);
    applyTransform(ctx, createStaticTransform({ scale: 2, anchor: [0, 0] }), { dx: 0, dy: 0, dw: 100, dh: 100 });
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, 10, 10);
    // 缩放 2× 且锚在原点 → 原 10×10 变成 20×20
    eq(px(dst, 5, 5)[0], 255, '仍在原点附近');
    eq(px(dst, 15, 15)[0], 255, '10..20 该被放大填满');
    eq(px(dst, 25, 25)[0], 0, '20 之外该是空的');
  });

  test('缩放围绕 anchor：中心锚点让中心不动', () => {
    const dst = createLayer(100, 100);
    const ctx = ctx2d(dst);
    applyTransform(ctx, createStaticTransform({ scale: 2, anchor: [0.5, 0.5] }), { dx: 0, dy: 0, dw: 100, dh: 100 });
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(45, 45, 10, 10);
    eq(px(dst, 50, 50)[0], 255, '中心该仍然是白的');
    eq(px(dst, 40, 50)[0], 255, '放大后该覆盖到 40');
  });

  test('scale <= 0 直接报错（别把整层画没）', () => {
    contains(throws(() => normalizeTransform({ scale: 0 }), 'scale=0').message, 'scale', 'scale');
    contains(throws(() => normalizeTransform({ scale: -1 }), 'scale 负').message, 'scale', 'scale');
  });

  test('keyframed：首尾钳制、中间插值（不外推）', () => {
    const fn = keyframed([
      [0, { scale: 1, tx: 0 }],
      [100, { scale: 2, tx: 100 }],
    ]);
    eq(fn(0).scale, 1, '起点');
    eq(fn(50).scale, 1.5, '中点插值');
    eq(fn(100).scale, 2, '终点');
    eq(fn(-50).scale, 1, '左侧钳制（不外推）');
    eq(fn(999).scale, 2, '右侧钳制（不外推）');
  });

  test('keyframed：重复帧号要报错', () => {
    const err = throws(() => keyframed([[0, {}], [0, {}]]), '重复关键帧');
    contains(err.message, '相同', '要说清问题');
  });

  test('breathing 是纯函数且幅度受控', () => {
    const f = breathing({ ampX: 3, ampY: 2 });
    eq(f(100).tx, f(100).tx, '同帧一致');
    ok(Math.abs(f(60).tx) <= 3.0001, `tx 幅度该 <= 3，实际 ${f(60).tx}`);
    ok(f(0).tx !== f(120).tx, '不同帧该不同');
  });

  test('lerpTransform 端点精确', () => {
    const a = createStaticTransform({ scale: 1, tx: 0 });
    const b = createStaticTransform({ scale: 3, tx: 20 });
    eq(lerpTransform(a, b, 0).tx, 0, 'k=0');
    eq(lerpTransform(a, b, 1).tx, 20, 'k=1');
    eq(lerpTransform(a, b, 0.5).scale, 2, 'k=0.5');
  });
});

describe('Phase 6 · LEAD 主导权表', () => {
  test('⭐ LEAD 表覆盖 [0, 4741)、无空洞无重叠', () => {
    eq(assertLeadTable(LEAD_TABLE, FRAME_COUNT), true, '表本身该合法');
  });

  test('空洞要报错，并带相邻两段标签', () => {
    const bad = [
      { from: 0, to: 100, lead: 'dsh', label: 'A' },
      { from: 110, to: 200, lead: 'user', label: 'B' },
    ];
    const err = throws(() => assertLeadTable(/** @type {any} */ (bad), 200), '有空洞');
    contains(err.message, 'GAP', '要说是空洞');
    contains(err.message, 'A', '要带前一段标签');
    contains(err.message, 'B', '要带后一段标签');
  });

  test('重叠要报错', () => {
    const bad = [
      { from: 0, to: 100, lead: 'dsh', label: 'A' },
      { from: 90, to: 200, lead: 'user', label: 'B' },
    ];
    const err = throws(() => assertLeadTable(/** @type {any} */ (bad), 200), '有重叠');
    contains(err.message, 'OVERLAP', '要说是重叠');
  });

  test('未覆盖到片尾要报错', () => {
    const bad = [{ from: 0, to: 100, lead: 'dsh', label: 'A' }];
    const err = throws(() => assertLeadTable(/** @type {any} */ (bad), FRAME_COUNT), '没覆盖完');
    contains(err.message, String(FRAME_COUNT), '要报出期望的帧数');
  });

  test('主角名不合法要报错', () => {
    const bad = [{ from: 0, to: 10, lead: 'nobody', label: 'A' }];
    contains(throws(() => assertLeadTable(/** @type {any} */ (bad), 10), '非法主角').message, 'nobody', '名字');
  });

  test('leadSpanAt：边界是左闭右开（419 帧属于第二段）', () => {
    eq(leadSpanAt(418).label.includes('引子'), true, '帧 418 还在引子里');
    eq(leadSpanAt(419).label.includes('第一幕'), true, '帧 419 该进第一幕');
  });

  test('leadAlphaAt：主角是 1，非主角是 NON_LEAD_ALPHA', () => {
    // 第一幕 (419..1903) 里 dsh 是主角
    eq(leadAlphaAt(1000, 'dsh'), 1, '第一幕 dsh 该是 1');
    ok(Math.abs(leadAlphaAt(1000, 'user') - NON_LEAD_ALPHA) < 1e-9, '第一幕 user 该降下去');
    // 第二幕 (2366..4741) 里 user 是主角
    eq(leadAlphaAt(3000, 'user'), 1, '第二幕 user 该是 1');
    ok(
      Math.abs(leadAlphaAt(3000, 'dsh') - NON_LEAD_ALPHA) < 1e-9,
      `第二幕 dsh 该降下去，实际 ${leadAlphaAt(3000, 'dsh')}`,
    );
    // 远离任何切换点时才该是精确值（切换窗口内是插值，不可能等于端点）
    ok(Math.abs(leadAlphaAt(4000, 'dsh') - NON_LEAD_ALPHA) < 1e-9, '帧 4000 远离边界');
  });

  test('切换时刻两侧亮度按预期变化（窗口结束在边界上，不会两条同时最亮）', () => {
    const boundary = 2366; // 2366 起 lead 变成 user
    const fade = 0.25 * 24; // 6 帧 → 窗口 [2360, 2366]

    // 窗口内：user 升（low → 1），dsh 降（1 → low）
    const uStart = leadAlphaAt(boundary - fade, 'user');
    const uMid = leadAlphaAt(boundary - fade / 2, 'user');
    const uEnd = leadAlphaAt(boundary, 'user');
    ok(Math.abs(uStart - NON_LEAD_ALPHA) < 1e-9, `窗口起点 user 该是 low，实际 ${uStart}`);
    ok(uStart < uMid && uMid < uEnd, `user 该单调升：${uStart} < ${uMid} < ${uEnd}`);
    eq(uEnd, 1, '到边界时 user 该已经到 1');

    const dStart = leadAlphaAt(boundary - fade, 'dsh');
    const dMid = leadAlphaAt(boundary - fade / 2, 'dsh');
    const dEnd = leadAlphaAt(boundary, 'dsh');
    eq(dStart, 1, '窗口起点 dsh 还是主角');
    ok(dStart > dMid && dMid > dEnd, `dsh 该单调降：${dStart} > ${dMid} > ${dEnd}`);
    ok(Math.abs(dEnd - NON_LEAD_ALPHA) < 1e-9, `到边界时 dsh 该降到 low，实际 ${dEnd}`);

    // ⭐ 窗口内两条轨道互补：`a + b = 1 + low` 恒成立，切换时总亮度守恒
    const sum = NON_LEAD_ALPHA + 1;
    for (let n = boundary - fade; n <= boundary + fade; n++) {
      const a = leadAlphaAt(n, 'user');
      const b = leadAlphaAt(n, 'dsh');
      ok(Math.abs(a + b - sum) < 1e-9, `帧 ${n} 两条轨道该互补：${a} + ${b} ≠ ${sum}`);
      ok(a <= 1 + 1e-9 && b <= 1 + 1e-9, `帧 ${n} 都不该超过 1`);
    }

    // 窗口外恢复端点值
    eq(leadAlphaAt(boundary - fade - 1, 'dsh'), 1, '窗口前 dsh 是主角');
    eq(leadAlphaAt(boundary + 1, 'user'), 1, '窗口后 user 是主角');
  });

  test('远离切换点时没有插值（alpha 就是端点值）', () => {
    for (const n of [500, 1000, 1500, 3000, 4000, 4700]) {
      const alphas = TRACKS.map((t) => leadAlphaAt(n, t));
      ok(
        alphas.every((a) => Math.abs(a - 1) < 1e-9 || Math.abs(a - NON_LEAD_ALPHA) < 1e-9),
        `帧 ${n} 的 alpha 该是端点值，实际 ${alphas.join('/')}`,
      );
    }
  });

  test('tracksAt：同一时刻在场的轨道数 <= 3（全局硬约束）', () => {
    for (const n of [0, 419, 1903, 2366, 4000, 4740]) {
      ok(tracksAt(n).length <= 3, `帧 ${n} 在场通道 ${tracksAt(n).length} <= 3`);
    }
    eq(tracksAt(1000).length, TRACKS.length, '两个轨道都在场（只是一个降了 alpha）');
  });
});

describe('Phase 6 · 截图源：缺帧必须报错', () => {
  test('缺一帧时报错并**指出帧号与轨道**', async () => {
    const src = memoryShotSource(new Map());
    let err = null;
    try {
      await src.load(240, 'dsh');
    } catch (e) {
      err = /** @type {Error} */ (e);
    }
    ok(err !== null, '该抛错');
    contains(err.message, '240', '要指出帧号');
    contains(err.message, 'dsh', '要指出轨道');
    contains(err.message, '不要静默跳过', '要说明为什么不能跳过');
    eq(src.stats().misses.length, 1, '缺失该被记账');
  });

  test('assertShotsPresent 一次列全缺失（比逐帧炸更好定位）', () => {
    const images = new Map([
      ['0|dsh', solid(4, 4, [0, 0, 0])],
      ['1|dsh', solid(4, 4, [0, 0, 0])],
    ]);
    const src = memoryShotSource(images);
    const err = throws(() => assertShotsPresent(src, 0, 4, ['dsh']), '缺 2 张');
    contains(err.message, '缺 2 张', '要报出缺几张');
    contains(err.message, 'n=2', '要列出缺哪些帧');
  });

  test('openShotSource：目录不存在时报错并给出补救命令', () => {
    const err = throws(() => openShotSource('out/definitely-not-here'), '目录不存在');
    contains(err.message, '截图目录不存在', '要说清是什么问题');
    contains(err.message, 'gen-frames.js', '要给出补救命令');
  });

  test('文件名约定：5 位零填充的帧号 + 轨道', () => {
    const src = memoryShotSource(new Map());
    eq(src.pathFor(240, 'dsh'), 'memory://240-dsh', '内存源');
    const real = openShotSource('film/vendor'); // 只为拿 pathFor，不 load
    eq(real.pathFor(240, 'user').endsWith('00240-user.png'), true, '磁盘源该是 00240-user.png');
  });
});

describe('Phase 6 · 1:1 贴入（不重采样文字）', () => {
  test('尺寸正确时贴入成功', async () => {
    const src = goodSource(0, 'dsh');
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });
    eq(layer.width, RECT.dw * DPR, '层宽 = 截图宽');
    eq(layer.height, RECT.dh * DPR, '层高 = 截图高');
  });

  test('截图尺寸 ≠ 目标矩形时报错（这是纪律，不是建议）', async () => {
    const src = memoryShotSource(new Map([['0|dsh', solid(100, 100, [0, 0, 0])]]));
    let err = null;
    try {
      await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });
    } catch (e) {
      err = /** @type {Error} */ (e);
    }
    ok(err !== null, '该抛错');
    contains(err.message, '1:1', '要说清是 1:1 的问题');
    contains(err.message, '不要用 drawImage 缩截图', '要给出正确做法');
  });

  test('rect 缺字段时报错', async () => {
    const src = goodSource(0, 'dsh');
    let err = null;
    try {
      await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: /** @type {any} */ ({ dx: 0 }) });
    } catch (e) {
      err = /** @type {Error} */ (e);
    }
    ok(err !== null, '该抛错');
    contains(err.message, 'rect.dw', '要指出缺哪个字段');
  });
});

describe('Phase 6 · 贴进画面：位移/缩放确实作用在内容上', () => {
  test('贴入后目标矩形内出现截图内容', async () => {
    const src = goodSource(0, 'dsh', [255, 0, 0]);
    const dst = createLayer(1920, 1080);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });
    applySubjectLayer(dst, { layer, rect: RECT, alpha: 1, dpr: DPR });
    eq(px(dst, RECT.dx + 10, RECT.dy + 10)[0], 255, '矩形内该是红的');
    eq(px(dst, RECT.dx - 10, RECT.dy - 10)[3], 0, '矩形外该是透明（清过）');
  });

  test('camera 位移把**网页内容**推走（不是推一个空框）', async () => {
    const src = goodSource(0, 'dsh', [0, 255, 0]);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });

    const dstA = createLayer(1920, 1080);
    applySubjectLayer(dstA, { layer, rect: RECT, camera: { tx: 0, ty: 0 }, dpr: DPR });
    const dstB = createLayer(1920, 1080);
    applySubjectLayer(dstB, { layer, rect: RECT, camera: { tx: 300, ty: 0 }, dpr: DPR });

    eq(px(dstA, RECT.dx + 10, RECT.dy + 10)[1], 255, '未平移时内容在 dx+10');
    eq(px(dstB, RECT.dx + 10, RECT.dy + 10)[1], 0, '平移 300 后该处空了');
    eq(px(dstB, RECT.dx + 310, RECT.dy + 10)[1], 255, '内容该出现在 dx+310');
  });

  test('camera 缩放把网页内容放大（像素被复制）', async () => {
    const src = goodSource(0, 'dsh', [0, 0, 255]);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });
    const dst = createLayer(1920, 1080);
    applySubjectLayer(dst, { layer, rect: RECT, camera: { scale: 2, anchor: [0, 0] }, dpr: DPR });
    // anchor=(0,0) + scale=2 → 矩形左上不动，尺寸翻倍
    eq(px(dst, RECT.dx + 5, RECT.dy + 5)[2], 255, '左上仍是内容');
    eq(px(dst, RECT.dx + RECT.dw + 100, RECT.dy + 5)[2], 255, '放大后超出了原矩形右边界');
  });

  test('alpha 降到 NON_LEAD_ALPHA 时亮度按比例下降（这就是「主导权」看得见的地方）', async () => {
    const src = goodSource(0, 'dsh', [255, 255, 255]);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });

    const full = createLayer(1920, 1080);
    applySubjectLayer(full, { layer, rect: RECT, alpha: 1, dpr: DPR });
    const dim = createLayer(1920, 1080);
    applySubjectLayer(dim, { layer, rect: RECT, alpha: NON_LEAD_ALPHA, dpr: DPR });

    const a = px(full, RECT.dx + 10, RECT.dy + 10);
    const b = px(dim, RECT.dx + 10, RECT.dy + 10);
    ok(a[0] > b[0], `非主角该更暗：${a[0]} → ${b[0]}`);
    eq(b[3], Math.round(255 * NON_LEAD_ALPHA), 'alpha 该按 NON_LEAD_ALPHA 写进第 4 通道');
  });

  test('alpha = 0 时整层不画', async () => {
    const src = goodSource(0, 'dsh', [255, 255, 255]);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect: RECT, dpr: DPR });
    const dst = createLayer(1920, 1080);
    const r = applySubjectLayer(dst, { layer, rect: RECT, alpha: 0, dpr: DPR });
    eq(r.drawn, false, '不该画');
    eq(px(dst, RECT.dx + 10, RECT.dy + 10)[3], 0, '该是全透明');
  });
});

describe('Phase 6 · 多轨道与「不猴补丁」', () => {
  test('overlayTracks 按 alpha 升序画（主角在上）', async () => {
    const small = { dx: 0, dy: 0, dw: 100, dh: 100 };
    const images = new Map([
      ['0|dsh', solid(200, 200, [255, 0, 0])],
      ['0|user', solid(200, 200, [0, 0, 255])],
    ]);
    const src = memoryShotSource(images);
    const dst = createLayer(200, 200);
    const r = await overlayTracks(dst, {
      n: 0,
      src,
      tracks: [
        { track: 'dsh', rect: small },
        { track: 'user', rect: small },
      ],
      dpr: 2,
      alphas: { dsh: NON_LEAD_ALPHA, user: 1 },
    });
    eq(r.drawn.length, 2, '两条都画');
    // user 的 alpha 更高 → 它在上面 → 中心应当是蓝的
    const p = px(dst, 50, 50);
    ok(p[2] > p[0], `alpha 高的该在上面：R=${p[0]} B=${p[2]}`);
  });

  test('**没有猴补丁**：kit 的导出没有多出「被塞进来」的属性', () => {
    // 参考项目用 kit.her_layer = ... 这种内存替换；我们从零写，不该出现
    const suspicious = Object.keys(kitCanvas).filter(
      (k) => /^(her_layer|her|subject_layer|patch|__)/i.test(k),
    );
    eq(suspicious.join(','), '', `kit/canvas.js 不该导出这些：${suspicious.join(',')}`);
    // 而且导出集合必须是「函数 / 对象 / 常量」，不是被替换掉的宿主函数
    for (const k of Object.keys(kitCanvas)) {
      const v = /** @type {any} */ (kitCanvas)[k];
      ok(v !== undefined, `导出 ${k} 不该是 undefined`);
    }
  });
});

describe('Phase 6 · 合成结果稳定（同参数两次一致）', () => {
  test('同一套输入合成两次，哈希相同', async () => {
    const mk = async () => {
      const stack = makeStack(300, 1920, 1080);
      const src = memoryShotSource(
        new Map([
          ['300|dsh', solid(RECT.dw * DPR, RECT.dh * DPR, [200, 180, 60])],
          ['300|user', solid(RECT.dw * DPR, RECT.dh * DPR, [60, 120, 200])],
        ]),
      );
      await overlayTracks(stack.subject, {
        n: 300,
        src,
        tracks: [
          { track: 'dsh', rect: RECT, camera: { tx: 12, ty: -8, scale: 1.05 } },
          { track: 'user', rect: { ...RECT, dx: RECT.dx + 1000 } },
        ],
        dpr: DPR,
      });
      return frameHash(stack.subject);
    };
    eq(await mk(), await mk(), '同参数两次合成的哈希');
  });

  test('相机参数变了，结果就该变（确认变换真的参与了）', async () => {
    const build = async (/** @type {number} */ tx) => {
      const stack = makeStack(0, 400, 200);
      const src = goodSource(0, 'dsh', [255, 255, 255]);
      await overlayTracks(stack.subject, {
        n: 0,
        src,
        tracks: [{ track: 'dsh', rect: { dx: 0, dy: 0, dw: 200, dh: 200 }, camera: { tx } }],
        dpr: 2,
        alphas: { dsh: 1 },
      });
      return frameHash(stack.subject);
    };
    ok((await build(0)) !== (await build(50)), 'tx=0 与 tx=50 该不同');
  });

  test('逐像素比对：两次合成 diff 为空', async () => {
    const build = async () => {
      const dst = createLayer(400, 300);
      const src = goodSource(7, 'dsh', [10, 200, 30]);
      const layer = await makeSubjectLayer({ n: 7, track: 'dsh', src, rect: { dx: 10, dy: 10, dw: 200, dh: 150 }, dpr: 2 });
      applySubjectLayer(dst, { layer, rect: { dx: 10, dy: 10, dw: 200, dh: 150 }, camera: { tx: 5, scale: 1.1 }, dpr: 2 });
      return rawRGBA(dst);
    };
    const d = diffRGBA(await build(), await build());
    ok(d.equal, `两次合成该逐像素一致，但有 ${d.pixels} 个像素不同`);
    eq(d.bbox, null, 'bbox');
  });
});

describe('Phase 6 · 端到端：磁盘上的真 PNG → 解码 → 贴进第 4 层', () => {
  test('openShotSource 读真 PNG 文件并合成（走完整链路，不是内存假对象）', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmp = 'out/_compose_e2e';
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });

    // 造一张「像截图一样」的真 PNG：1920×1280（= 960×640 CSS @dpr2），左半红右半蓝
    const shotW = 1920;
    const shotH = 1280;
    const cv = createCanvas(shotW, shotH);
    const c = ctx2d(cv);
    c.fillStyle = 'rgb(255,0,0)';
    c.fillRect(0, 0, shotW / 2, shotH);
    c.fillStyle = 'rgb(0,0,255)';
    c.fillRect(shotW / 2, 0, shotW / 2, shotH);
    writeFileSync(join(tmp, '00000-dsh.png'), cv.toBuffer('image/png'));

    // 目标矩形正好是 960×640 @dpr2 —— 也就是 1:1
    const rect = { dx: 400, dy: 200, dw: 960, dh: 640 };
    const src = openShotSource(tmp);
    const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect, dpr: 2 });
    eq(layer.width, shotW, '层宽该等于截图宽');
    eq(layer.height, shotH, '层高该等于截图高');

    const dst = createLayer(1920, 1080);
    applySubjectLayer(dst, { layer, rect, alpha: 1, dpr: 2 });
    // 矩形左半该是红的、右半该是蓝的 —— 证明**内容**真的进来了、且没有重采样错位
    const left = px(dst, rect.dx + 100, rect.dy + 100);
    const right = px(dst, rect.dx + rect.dw - 100, rect.dy + 100);
    eq(left[0], 255, '左半红');
    eq(left[2], 0, '左半不该有蓝');
    eq(right[2], 255, '右半蓝');
    eq(right[0], 0, '右半不该有红');

    rmSync(tmp, { recursive: true, force: true });
  });

  test('磁盘源缺帧时抛的错里带真实路径（好让人直接去看）', async () => {
    const { mkdirSync, rmSync } = await import('node:fs');
    const tmp = 'out/_compose_e2e_missing';
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const src = openShotSource(tmp);
    let err = null;
    try {
      await src.load(777, 'user');
    } catch (e) {
      err = /** @type {Error} */ (e);
    }
    ok(err !== null, '该抛错');
    contains(err.message, '00777-user.png', '要带真实文件名');
    contains(err.message, '777', '要带帧号');
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('Phase 6 · 引擎挂钩：trackLayers 是**显式参数**，不是猴补丁', () => {
  test('frameAsync 带 trackLayers 时第 4 层真的有内容', async () => {
    const { frameAsync, frame } = await import('../engine/frame.js');
    const rect = { dx: 400, dy: 200, dw: 960, dh: 640 };
    const src = memoryShotSource(new Map([['0|dsh', solid(1920, 1280, [255, 0, 0])]]));

    const noOverlay = frame(0, null, { postEnable: { trail: false, bloom: false, scanlines: false, vignette: false } });
    const withOverlay = await frameAsync(0, null, {
      trackLayers: async (stack) => {
        const layer = await makeSubjectLayer({ n: 0, track: 'dsh', src, rect, dpr: 2 });
        applySubjectLayer(stack.subject, { layer, rect, alpha: 1, dpr: 2 });
      },
      postEnable: { trail: false, bloom: false, scanlines: false, vignette: false },
    });

    ok(frameHash(noOverlay) !== frameHash(withOverlay), '贴了轨道层后画面该不同');
    eq(px(withOverlay, rect.dx + 50, rect.dy + 50)[0], 255, '第 4 层的内容该露出来');
    eq(withOverlay.width, 1920, '尺寸仍是 W');
    eq(withOverlay.height, 1080, '尺寸仍是 H');
  });

  test('没有 trackLayers 时 frameAsync 与 frame 逐像素一致（轨道层是纯加法）', async () => {
    const { frameAsync, frame } = await import('../engine/frame.js');
    const off = { trail: false, bloom: false, scanlines: false, vignette: false };
    const a = rawRGBA(frame(300, null, { postEnable: off }));
    const b = rawRGBA(await frameAsync(300, null, { postEnable: off }));
    const d = diffRGBA(a, b);
    ok(d.equal, `该逐像素一致，但有 ${d.pixels} 个像素不同`);
  });

  test('同步 frame() 拿到 trackLayers 时同步报错（不是静默忽略）', async () => {
    const { frame } = await import('../engine/frame.js');
    const err = throws(
      () => frame(0, null, { trackLayers: async () => {} }),
      '同步 frame 不支持 trackLayers',
    );
    contains(err.message, 'frameAsync', '要指向正确的方法');
  });
});

describe('Phase 6 · shots 的缓存有界（别把 4741 帧全留在内存）', () => {
  test('BoundedCache 风格的淘汰：超过容量就丢最老的', async () => {
    // 用一个临时目录，放 70 张小图，验证 load 不会把它们全留着
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmp = 'out/_compose_cache_test';
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const cv = createCanvas(2, 2);
    ctx2d(cv).fillStyle = 'rgb(1,2,3)';
    ctx2d(cv).fillRect(0, 0, 2, 2);
    const png = cv.toBuffer('image/png');
    for (let n = 0; n < 70; n++) {
      writeFileSync(join(tmp, `${String(n).padStart(5, '0')}-dsh.png`), png);
    }
    const src = openShotSource(tmp);
    for (let n = 0; n < 70; n++) await src.load(n, 'dsh');
    eq(src.stats().loads, 70, '该读了 70 张');
    eq(src.stats().hits, 0, '第一次都该是 miss→load');
    // 再读第 0 张：它早该被淘汰，所以又是一次 load
    const before = src.stats().loads;
    await src.load(0, 'dsh');
    eq(src.stats().loads, before + 1, '第 0 张该已被淘汰（缓存是有界的）');
    rmSync(tmp, { recursive: true, force: true });
  });
});
