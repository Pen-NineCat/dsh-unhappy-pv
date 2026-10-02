/**
 * film/test/cursor.test.js — **T5 的后半**：她（鼠标）与 memory 的机器判据。
 *
 * 画面规格 §1.2 给 T5 的判据是：
 * > 过程可见：字逐字出现又退掉、**memory 多两行**、**鼠标落点与时刻正确**
 *
 * 前两条的一半（网页侧的输入框）在 `pages.test.js` 里；这里管
 * **鼠标**（§三 的路径契约六条）与 **memory**（§2.2「原歌词只进 memory」）。
 *
 * ⚠️ 这里**不测好看**。护栏能证的只有：落点在不在那个控件上、时刻对不对、
 * 抖动是不是低频的、像素有没有画出来。至于"她看起来像不像一只手在动"，
 * 只能靠 `film/test/probe-t5.mjs` 出的图给人眼看 —— 报告里如实这么写。
 */

import { FPS, H, W, frameAt } from '../engine/clock.js';
import { frame } from '../engine/frame.js';
import {
  CURSOR_FIRST_FRAME,
  JITTER_MAX,
  KEYPOINTS,
  OVERSHOOT,
  cursorAt,
  jitterAt,
  shapesIn,
} from '../engine/cursor.js';
import { ANCHORS, CELLS, CONTROLS, PANEL, cursorShapeAt } from '../engine/layout.js';
import { makeStack } from '../engine/layers.js';
import { createLayer } from '../kit/canvas.js';
import { bbox, readRaw } from '../kit/raster.js';
import { CURSOR_SHAPES, drawCursor, drawCursorShape } from '../content/cursor.js';
import { ENTRIES, MEMORY_LINE_H, drawMemory, memoryRowsAt, rowRect } from '../content/memory.js';
import { drawAct1 } from '../content/act1.js';
import * as act1 from '../pages/act1.js';
import { eq, ok, test, describe } from './_harness.js';

/** 一张图里的非空像素数（`bbox()` 只给外接框，这里要"有没有画东西"）。 */
function countInk(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n;
}

/** 各层有没有墨（六层的 z 序判据用）。 */
function layerInk(stack) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of ['background', 'content', 'carriers', 'subject', 'chrome']) {
    out[k] = countInk(readRaw(/** @type {any} */ (stack)[k]));
  }
  return out;
}

/** 一个只带 `n`/`stack` 的最小 FrameState（画布侧的函数只用这两样）。 */
function fakeState(n, stack) {
  return /** @type {any} */ ({ n, t: n / FPS, stack, prev: null, postCfg: {} });
}

describe('T5 · 鼠标：路径契约（画面规格 §三）', () => {
  test('关键点清单是唯一来源，落点必须都在 ANCHORS 里', () => {
    ok(KEYPOINTS.length >= 3, `关键点太少（${KEYPOINTS.length}）`);
    for (const k of KEYPOINTS) {
      ok(Object.keys(ANCHORS).includes(k.at), `关键点 ${k.n} 的锚点 ${k.at} 不在 ANCHORS 里`);
      eq(k.n, frameAt(k.t), `帧号必须由 t 算出来（n = round(t × FPS)）`);
    }
    for (let i = 1; i < KEYPOINTS.length; i++) {
      ok(KEYPOINTS[i].n > KEYPOINTS[i - 1].n, `关键点必须严格递增（第 ${i} 个）`);
    }
  });

  test('关键点的时刻与逐句表对齐（419 = 开词帧、483 = 下一句开口那一帧）', () => {
    eq(KEYPOINTS[0].n, act1.ACT1.start, '第一个关键点在开词帧');
    eq(KEYPOINTS[0].n, Math.round(17.454 * FPS), '17.454s → 419');
    eq(KEYPOINTS[1].n, act1.INPUT_WINDOW.deleteEnd, '第二个关键点 = 她删完最后一个字那一帧');
    eq(KEYPOINTS[1].n, Math.round(20.114 * FPS), '20.114s → 483');
  });

  test('⭐ 落点与时刻正确：每个关键点那一帧，她就在那个锚点上（只在抖动幅度内偏）', () => {
    for (const k of KEYPOINTS) {
      const c = cursorAt(k.n);
      ok(c.visible, `帧 ${k.n} 该看得见她`);
      eq(c.x >= k.x - JITTER_MAX - 0.01 && c.x <= k.x + JITTER_MAX + 0.01, true, `帧 ${k.n} 的 x 偏离锚点超过 ${JITTER_MAX}px（${c.x} vs ${k.x}）`);
      eq(c.y >= k.y - JITTER_MAX - 0.01 && c.y <= k.y + JITTER_MAX + 0.01, true, `帧 ${k.n} 的 y 偏离锚点超过 ${JITTER_MAX}px（${c.y} vs ${k.y}）`);
      // 落点还必须真的在**它该在的那个控件**上（这条才是"落点正确"的硬判据）
      if (k.at === 'composer.input') eq(c.shape, 'ibeam', `帧 ${k.n} 她该在输入框上（I-beam）`);
      if (k.at === 'left.watch') eq(c.shape, 'arrow', `帧 ${k.n} 她已经离开输入框（箭头）`);
    }
  });

  test('⛔ 引子（0–419）**没有**鼠标 —— §2.1 的画面清单里没有它（待作者拍板）', () => {
    for (const n of [0, 100, 300, 418]) {
      eq(cursorAt(n).visible, false, `帧 ${n} 不该有鼠标（引子）`);
    }
    eq(CURSOR_FIRST_FRAME, 419, '她第一次出现 = 开词帧');
    eq(cursorAt(419).visible, true, '帧 419 她在');
    // ⚠️ 这条不是"设计如此"，而是"§2.1 没写、所以没做"。
    //    O1 的载体②说"那个**一直在动的**鼠标箭头"，若作者要把她放进引子，
    //    改的是 data/cursor/keypoints.json（加一个 0 附近的关键点）—— 那会改已验收的引子。
  });

  test('T5 里只出现两种形状：I-beam（在输入框）与箭头（出来后）', () => {
    const s = shapesIn(act1.ACT1.start, 802);
    eq([...s].sort().join(','), 'arrow,ibeam', `T5 里出现过的形状：${[...s].join(',')}`);
  });

  test('形状由落点推断：输入框矩形内 = I-beam、按钮上 = 手型、其余 = 箭头', () => {
    const inp = CONTROLS['composer.input'];
    const add = CONTROLS['composer.add'];
    const send = CONTROLS['composer.send'];
    eq(cursorShapeAt(inp.x + 1, inp.y + 1), 'ibeam', '输入框左上角内');
    eq(cursorShapeAt(inp.x + inp.w - 1, inp.y + inp.h - 1), 'ibeam', '输入框右下角内');
    eq(cursorShapeAt(inp.x - 1, inp.y + 1), 'arrow', '输入框左外侧');
    eq(cursorShapeAt(inp.x + 1, inp.y + inp.h), 'arrow', '输入框下沿之外（它的高只有 36）');
    eq(cursorShapeAt(add.x + 1, add.y + 1), 'hand', '「+」按钮上');
    eq(cursorShapeAt(send.x + 1, send.y + 1), 'hand', '发送按钮上');
    // 锚点自身也要落在该落的控件上
    eq(cursorShapeAt(ANCHORS['composer.input'].x, ANCHORS['composer.input'].y), 'ibeam', '输入框锚点');
    eq(cursorShapeAt(ANCHORS['left.watch'].x, ANCHORS['left.watch'].y), 'arrow', '对话区锚点');
  });

  test('⭐ 抖动是**低频平滑**的，不是逐帧独立随机（§三 的原话：逐帧独立看起来是静电）', () => {
    /** @type {number[]} */
    const steps = [];
    let prev = jitterAt(act1.ACT1.start);
    let totalVariation = 0;
    for (let n = act1.ACT1.start + 1; n < 700; n++) {
      const j = jitterAt(n);
      const d = Math.hypot(j.x - prev.x, j.y - prev.y);
      steps.push(d);
      totalVariation += d;
      prev = j;
    }
    const maxStep = Math.max(...steps);
    ok(maxStep < 1.5, `相邻帧的抖动位移最大 ${maxStep.toFixed(3)}px —— 逐帧独立随机就是这个量级（该 < 1.5）`);
    // 而且它**确实在动**（不是恒等于 0 的假平滑）
    ok(totalVariation > 5, `两百多帧的抖动总位移只有 ${totalVariation.toFixed(2)}px —— 她像被钉住了`);
    // 幅度在契约里（1–3px）
    for (const n of [419, 500, 700]) {
      const j = jitterAt(n);
      const r = Math.hypot(j.x, j.y);
      ok(r >= 0 && r <= JITTER_MAX + 0.001, `帧 ${n} 的抖动幅度 ${r.toFixed(2)}px 超出 ${JITTER_MAX}px`);
    }
  });

  test('缓动是 ease-in-out：起步与收尾慢、中间快（不是匀速直线）', () => {
    // 沿 A→B 方向的**进度** s(n)：0 = 起点、1 = 终点（不含抖动的那部分也够看趋势）
    const A = KEYPOINTS[1];
    const B = KEYPOINTS[2];
    const dir = { x: B.x - A.x, y: B.y - A.y };
    const len2 = dir.x * dir.x + dir.y * dir.y;
    /** @param {number} n */
    const s = (n) => {
      const c = cursorAt(n);
      return ((c.x - A.x) * dir.x + (c.y - A.y) * dir.y) / len2;
    };
    const mid = Math.round((A.n + B.n) / 2);
    // 位移的绝对值（速度），不是进度：起点/中段/终点各取一段
    const speedStart = s(A.n + 3) - s(A.n + 2);
    const speedMid = s(mid + 3) - s(mid + 2);
    const speedEnd = s(B.n) - s(B.n - 1);
    ok(speedMid > speedStart * 1.5, `中段速度 ${speedMid.toFixed(4)} 该明显快于起步 ${speedStart.toFixed(4)}`);
    ok(speedMid > speedEnd * 1.5, `中段速度 ${speedMid.toFixed(4)} 该明显快于收尾 ${speedEnd.toFixed(4)}`);
    ok(speedStart > 0, `起步该在动（${speedStart}）`);
  });

  test('⭐ 一次轻微过冲：她冲过目标一点再落回来（§三 的「一次轻微过冲」）', () => {
    const A = KEYPOINTS[1];
    const B = KEYPOINTS[2];
    // 位移方向上的**进度**（1 = 正好到 B）
    const dir = { x: B.x - A.x, y: B.y - A.y };
    const len2 = dir.x * dir.x + dir.y * dir.y;
    /** @param {number} n */
    const s = (n) => {
      const c = cursorAt(n);
      return ((c.x - A.x) * dir.x + (c.y - A.y) * dir.y) / len2;
    };
    // ⚠️ 抖动会叠加在这上面，所以判据用"过冲幅度"而不是逐帧比较
    let maxS = -Infinity;
    for (let n = A.n; n <= B.n; n++) maxS = Math.max(maxS, s(n));
    const atB = s(B.n);
    ok(maxS > atB + 0.005, `全程最大进度 ${maxS.toFixed(4)} 没有超过终点 ${atB.toFixed(4)} —— 没有过冲`);
    ok(maxS < atB + OVERSHOOT + 0.01, `过冲 ${(maxS - atB).toFixed(4)} 超过了契约的 ${OVERSHOOT}`);
  });

  test('纯函数：同一帧两次调用完全相同（这是她能被逐帧渲染的前提）', () => {
    for (const n of [419, 440, 483, 490, 498, 700, 1902]) {
      const a = cursorAt(n);
      const b = cursorAt(n);
      eq(JSON.stringify(a), JSON.stringify(b), `帧 ${n}`);
    }
  });

  test('她在 T5 的每一帧都在画面里，且不在任何格子的边界上跳', () => {
    for (let n = act1.ACT1.start; n < 802; n++) {
      const c = cursorAt(n);
      ok(c.visible, `帧 ${n} 该看得见她`);
      ok(c.x >= 1 && c.x <= W - 2 && c.y >= 1 && c.y <= H - 2, `帧 ${n} 她跑到画面外了：(${c.x}, ${c.y})`);
      ok(Math.abs(c.x - 573) < 40 && Math.abs(c.y - 1000) < 120, `帧 ${n} 她在 (${c.x.toFixed(1)}, ${c.y.toFixed(1)})，离两个锚点太远`);
    }
  });

  test('全片都能问"她在哪"（不会在没写关键点的地方抛错或返回 NaN）', () => {
    for (const n of [0, 419, 802, 1217, 1560, 1903, 2366, 4740]) {
      const c = cursorAt(n);
      ok(Number.isFinite(c.x) && Number.isFinite(c.y), `帧 ${n} 的坐标是 NaN`);
      ok(['arrow', 'ibeam', 'hand'].includes(c.shape), `帧 ${n} 的形状 ${c.shape} 不认识`);
    }
  });
});

describe('T5 · 鼠标的三个形状（自己画的，尺寸对得上真鼠标）', () => {
  test('外接框：箭头 12×19、I-beam 7×16、手型 11×21', () => {
    // 数值来自本机 aero_arrow.cur / 惯例尺寸（见 content/cursor.js 文件头的表）
    const want = { arrow: [11, 18], ibeam: [6, 16], hand: [10, 20] };
    for (const [shape, pts] of Object.entries(CURSOR_SHAPES)) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      eq(`${w}×${h}`, `${want[/** @type {keyof typeof want} */ (shape)][0]}×${want[/** @type {keyof typeof want} */ (shape)][1]}`, `${shape} 的顶点表外接框`);
    }
  });

  test('画出来确实落在那块地方（外接框 = 顶点表 + 描边那 1px）', () => {
    // 顶点表的**跨度**（max−min）：箭头 11×18 ⇒ 实际覆盖 12×19 个像素
    for (const [shape, [w, h]] of [
      ['arrow', [11, 18]],
      ['ibeam', [6, 16]],
      ['hand', [10, 20]],
    ]) {
      const cv = createLayer(64, 64);
      drawCursorShape(cv, /** @type {any} */ (shape), 24, 24);
      const img = readRaw(cv);
      const bb = bbox(img);
      ok(bb, `${shape} 什么都没画出来`);
      ok(countInk(img) > 20, `${shape} 只有 ${countInk(img)} 个像素`);
      // 描边 1px：外接框最多比顶点跨度多 2（左右各 1），不许"缩着画"或"涨一圈"
      const bw = bb.x1 - bb.x0;
      const bh = bb.y1 - bb.y0;
      ok(Math.abs(bw - w) <= 2, `${shape} 画出来宽 ${bw}，顶点跨度是 ${w}`);
      ok(Math.abs(bh - h) <= 2, `${shape} 画出来高 ${bh}，顶点跨度是 ${h}`);
      // 颜色：**深色描边 + 白填充**（真鼠标实测就是这两个颜色）。
      // 判据用"各类像素占墨迹的比例"，而不是去戳某一个坐标 —— 后者会因为抗锯齿而误判。
      let ink = 0;
      let white = 0;
      let dark = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] <= 0) continue;
        ink++;
        const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
        if (img.data[i + 3] > 200 && r > 200 && g > 200 && b > 200) white++;
        else if (r < 128 && g < 128 && b < 128) dark++;
      }
      ok(dark / ink > 0.3, `${shape} 的深色描边只占 ${((dark / ink) * 100).toFixed(0)}% —— 描边丢了？`);
      // ⚠️ I-beam 只有 7px 宽、描边就 1px，所以它**几乎没有白心**（实测 4/96）——
      //    真鼠标的文本光标也是这样（细笔画上描边吃掉了填充）。所以判据按形状分档。
      const minWhite = shape === 'ibeam' ? 0.02 : 0.3;
      ok(white / ink >= minWhite, `${shape} 的白色填充只占 ${((white / ink) * 100).toFixed(0)}%（该 ≥ ${minWhite * 100}%）`);
    }
  });

  test('手型这一版没有任何一帧用到 —— 但它至少画得出东西（未被肉眼验过，如实标注）', () => {
    const s = shapesIn(0, 4741);
    eq(s.has('hand'), false, '当前全片没有一帧落在可点控件上（T8/T7 才会）');
    const cv = createLayer(40, 40);
    drawCursorShape(cv, 'hand', 5, 5);
    ok(countInk(readRaw(cv)) > 30, '手型画出来是空的 —— 那才是真的坏了');
  });

  test('不认识的形状当场报错（不要静默画一个箭头）', () => {
    let msg = '';
    try {
      drawCursorShape(createLayer(8, 8), /** @type {any} */ ('spinner'), 4, 4);
    } catch (e) {
      msg = /** @type {Error} */ (e).message;
    }
    ok(msg.includes('spinner'), `报错要说清是哪个形状：${msg}`);
    ok(msg.includes('arrow'), '报错要列出可用形状');
  });

  test('她与 memory 都画在 **chrome** 层（六层里最上面那层）—— 不能被左格截图盖掉', () => {
    const n = 700;
    const stack = makeStack(n, W, H);
    drawAct1(fakeState(n, stack));
    const ink = layerInk(stack);
    eq(ink.chrome > 0, true, 'chrome 该有东西');
    eq(ink.background + ink.content + ink.carriers + ink.subject, 0, `她与面板不该画进别的层：${JSON.stringify(ink)}`);
    // ⚠️ 这条守的是 z 序：左格那张网页截图由 track-layer 贴进 subject（在语段函数**之后**，
    //    并且会 clearRect 整层），所以画进 subject 的东西会被截图清掉/盖掉。
  });
});

describe('T5 · memory 多两行（§2.2「原歌词只进 memory」）', () => {
  test('这份表和页面侧的原歌词**逐条一致**（两份表不许漂；测试就是那个同步机制）', () => {
    eq(ENTRIES.length, act1.CONTEXT_EVENTS.length, '条数');
    ENTRIES.forEach((e, i) => {
      const p = act1.CONTEXT_EVENTS[i];
      eq(e.n, p.n, `第 ${i} 条的帧号`);
      eq(e.text, p.text, `第 ${i} 条的文本（memory 记的是**原歌词**，不是改写后的那句）`);
    });
  });

  test('⭐ 行数：586 之前 0 条 → 586 起 1 条 → 642 起 2 条（这就是"多两行"）', () => {
    eq(memoryRowsAt(585).length, 0, '585：还没有');
    eq(memoryRowsAt(586).length, 1, '586：第一行');
    eq(memoryRowsAt(641).length, 1, '641：还是一行');
    eq(memoryRowsAt(642).length, 2, '642：第二行 —— 判据达成');
    eq(memoryRowsAt(802).length, 2, 'T5 结束时两行都在（"会留下来的东西"）');
    eq(memoryRowsAt(4740).length, 2, '第一幕之后也没消失');
    // 全片分布：T5 里从 0 变到 2，且**只增不减**
    let prev = 0;
    for (let n = act1.ACT1.start; n < 1903; n++) {
      const k = memoryRowsAt(n).length;
      ok(k >= prev, `帧 ${n} 的记录数从 ${prev} 掉到 ${k} —— 记忆只能累积（§三）`);
      prev = k;
    }
    eq(prev, 2, '第一幕结束时的记录数');
  });

  test('两条记录都落在 memory 面板里，而且不压到标题行', () => {
    const panel = CELLS.memory;
    for (let i = 0; i < ENTRIES.length; i++) {
      const r = rowRect(i);
      ok(r.x >= panel.x && r.x + r.w <= panel.x + panel.w, `第 ${i} 行横向越界`);
      ok(r.y >= panel.y + PANEL.titleRow, `第 ${i} 行压到标题行了`);
      ok(r.y + r.h <= panel.y + panel.h, `第 ${i} 行掉出面板了`);
    }
    ok(rowRect(ENTRIES.length - 1).y + MEMORY_LINE_H < panel.y + panel.h, '最后一行要在面板里留出余量');
  });

  test('像素判据：有记录的帧真的在那一块画了东西，没记录的帧一点都不画', () => {
    // 空帧：这一格必须**干净**（T4 的"内容为空"标准在 419–585 仍然成立）
    const empty = createLayer(W, H);
    eq(drawMemory(fakeState(500, { chrome: empty })).rows, 0, '帧 500 没有记录');
    eq(bbox(readRaw(empty)), null, '帧 500 的 memory 层不该有任何墨');

    for (const [n, rows] of [
      [600, 1],
      [700, 2],
    ]) {
      const cv = createLayer(W, H);
      eq(drawMemory(fakeState(n, { chrome: cv })).rows, rows, `帧 ${n} 的记录数`);
      const bb = bbox(readRaw(cv));
      ok(bb, `帧 ${n} 该画了字`);
      const first = rowRect(0);
      const last = rowRect(rows - 1);
      ok(bb.y0 >= first.y - 4 && bb.y1 <= last.y + MEMORY_LINE_H, `帧 ${n} 的墨迹超出了记录行：${JSON.stringify(bb)}`);
      ok(bb.x0 >= CELLS.memory.x, `帧 ${n} 的墨迹跑到 memory 面板左边了`);
    }
  });

  test('她真的出现在**合成后**的画面上（不是只活在模块里）', () => {
    const n = 700;
    const c = cursorAt(n);
    const cv = frame(n);
    eq(cv.width, W, '画布宽');
    eq(cv.height, H, '画布高');
    // 这一帧的左格没有内容（截图由 track-layer 在别处贴），合成底是黑的 ——
    // 所以她那只白箭头在画面里是唯一的亮点，直接数像素就能证。
    const img = readRaw(cv);
    let white = 0;
    for (let y = Math.round(c.y) - 24; y <= Math.round(c.y) + 24; y++) {
      for (let x = Math.round(c.x) - 24; x <= Math.round(c.x) + 24; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200) white++;
      }
    }
    ok(white > 20, `她那一带只数出 ${white} 个近白像素 —— 她没进合成结果`);
    void drawCursor;
  });
});
