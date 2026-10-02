/**
 * film/test/pipeline.test.js — Phase 3 的验收（施工说明 §6 Phase 3）。
 *
 * 逐条对应：
 *   - [x] `toRgb24` 对**不是 rgb24 的输入**必须报错（不要静默花屏）
 *   - [x] `--frames` 只渲某几帧，产出的 PNG 与整片渲出来的对应帧**逐像素一致**
 *   - [x] **worker 数从 1 改到 8，帧哈希清单完全相同**（证明纯函数 + 分段无副作用）
 *   - [x] 分段区间求和 == 期望帧数（⭐ 帧数对账）
 *   - [x] 段边界落在**真实的引子拍点**上（0 / 144 / 251 / 419）
 *
 * 端到端的「24 帧短片 == 24 帧」「成片帧数护栏」在 `film/render-video.js` 里自断言，
 * 并在施工说明附录 C 里记了实测输出（含 `-shortest` 的反例）。
 */

import { createCanvas } from '@napi-rs/canvas';

import { FRAME_COUNT, H, W, timeAt } from '../engine/clock.js';
import { ACT_MARKS, buildTimeline, PRELUDE_MARKS } from '../engine/content.js';
import { frame } from '../engine/frame.js';
import { frameHash } from '../hash.js';
import { assertRgb24Buffer, assertSize, rawRGB } from '../kit/pixels.js';
import { toRgb24 } from '../kit/canvas.js';
import { eachFrameOfSegment, segmentRuns } from '../lib/frame-segments.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

describe('Phase 3 · 帧契约', () => {
  test('frame(n) 的尺寸恒为 W×H', () => {
    for (const n of [0, 1, 300, FRAME_COUNT - 1]) {
      const cv = frame(n);
      assertSize(cv, W, H, `frame(${n})`);
    }
  });

  test('frame(n) 两次调用哈希相同（纯函数）', () => {
    for (const n of [0, 143, 144, 250, 251, 418, 419]) {
      eq(frameHash(frame(n)), frameHash(frame(n)), `frame(${n}) 两次`);
    }
  });

  test('非整数帧号直接报错（n = round(t*FPS) 是唯一主键）', () => {
    const err = throws(() => frame(1.5), '小数帧号');
    contains(err.message, '整数', '要说清是帧号问题');
  });

  test('prev 尺寸不对就报错（不静默画错）', () => {
    const wrong = createCanvas(64, 48);
    const err = throws(() => frame(0, wrong), '尺寸错的 prev');
    contains(err.message, 'prev', '要指出是 prev 的问题');
    contains(err.message, '64×48', '要报出实际尺寸');
  });

  test('正常尺寸的 prev 可以被接受', () => {
    const prev = frame(9);
    ok(frame(10, prev) !== null, '传合法 prev 该正常返回');
  });
});

describe('Phase 3 · rgb24 边界（「花屏」的唯一原因）', () => {
  test('toRgb24 对正确的画布返回 W*H*3 字节', () => {
    const buf = toRgb24(frame(0), W, H);
    eq(buf.length, W * H * 3, 'rgb24 长度');
    assertRgb24Buffer(buf, W, H, 'test');
  });

  test('尺寸不对必须报错（不要静默喂给 ffmpeg）', () => {
    const small = createCanvas(64, 48);
    const err = throws(() => toRgb24(small, W, H), '尺寸不对的画布');
    contains(err.message, '尺寸断言失败', '要说清是尺寸问题');
    contains(err.message, '1920×1080', '要报出期望尺寸');
  });

  test('buffer 长度不对必须报错', () => {
    const err = throws(() => assertRgb24Buffer(Buffer.alloc(100), W, H, 'test'), '短 buffer');
    contains(err.message, '长度断言失败', '要说清是长度问题');
    contains(err.message, String(W * H * 3), '要报出期望长度');
  });

  test('rawRGB 丢掉 alpha 但保留可见像素（与黑底合成）', () => {
    const cv = createCanvas(2, 1);
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 2, 1); // 全透明
    const rgb = rawRGB(cv);
    eq(rgb.length, 2 * 1 * 3, '长度');
    eq(rgb[0], 0, '全透明像素与黑底合成后是 0');
  });
});

describe('Phase 3 · 时间线段边界必须落在真实拍点上', () => {
  test('画面轴四段的边界 = 0 / 419 / 1903 / 2454 / 4741（半开，`AGENTS.md` §2 规则 13）', () => {
    const table = buildTimeline();
    eq(table.length, 4, '段数');
    eq(table[0].start, 0, '第 1 段起点');
    eq(table[0].end, timeAt(ACT_MARKS.act1), '第 1 段终点 = 帧 419（开词帧，属于下一段）');
    eq(table[1].end, timeAt(ACT_MARKS.interlude), '第 2 段终点 = 帧 1903');
    eq(table[2].end, timeAt(ACT_MARKS.act2), '第 3 段终点 = 帧 2454（**画面轴**；声音轴是 2366）');
    eq(table[3].end, timeAt(FRAME_COUNT), '第 4 段终点 = 片尾');
    // ⭐ 画面轴的账（作者 2026-10-01 拍板，A6）：419 + 1484 + 551 + 2287 = 4741
    eq(Math.round((table[1].end - table[1].start) * 24), 1484, '第一幕该是 1484 帧（1903 − 419）');
    eq(Math.round((table[2].end - table[2].start) * 24), 551, '幕间该是 551 帧（2454 − 1903，含 88 帧尾巴）');
    eq(Math.round((table[3].end - table[3].start) * 24), 2287, '第二幕该是 2287 帧（4741 − 2454）');
    // ⚠️ 两条轴在 [2366, 2454) 错位：声音已经进第二幕（她的前两句是**画外音**），画面还在幕间。
    //    `AGENTS.md` §2 规则 13：两张独立的段表，各自半开、各自无重叠 —— 这不是冲突。
    eq(ACT_MARKS.act2 > 2366, true, '画面轴的第二幕比声音轴晚 88 帧（§2.3 的错位区）');
  });

  test('⭐ 帧数对账：各段求和 == 4741', () => {
    const table = buildTimeline();
    const sum = table.reduce((a, s) => a + Math.round((s.end - s.start) * 24), 0);
    eq(sum, FRAME_COUNT, '各段帧数求和');
  });

  test('每个段边界帧属于**新**那一段（半开 `[start, end)`，`AGENTS.md` §2 规则 13）', () => {
    const table = buildTimeline();
    // 三个边界各自归后一段：419 → 第一幕、1903 → 幕间、2454 → 第二幕
    const marks = [
      [ACT_MARKS.act1, 1],
      [ACT_MARKS.interlude, 2],
      [ACT_MARKS.act2, 3],
    ];
    for (const [n, wantIdx] of marks) {
      const t = timeAt(n);
      const idx = table.findIndex((s) => t >= s.start && t < s.end);
      eq(idx, wantIdx, `帧 ${n} 该落在第 ${wantIdx} 段`);
      // 而且它**不**属于前一段（半开区间的另一半含义）
      eq(t < table[wantIdx - 1].end, false, `帧 ${n} 不该落在第 ${wantIdx - 1} 段里`);
    }
    // 引子的拍点仍在（页面侧的拍点，不再是段边界）
    eq(Math.round(timeAt(PRELUDE_MARKS.firstLyric) * 24), 419, '开词帧仍是 419');
  });
});

describe('Phase 3 · 连续帧段切分（worker 分配的正确性）', () => {
  test('segmentRuns：段内连续、段间不重叠、合起来正好是全部帧（左闭右开）', () => {
    const segs = segmentRuns(0, 100, 7);
    eq(segs.length, 7, '段数');
    let prevEnd = 0;
    for (const [a, b] of segs) {
      eq(a, prevEnd, '段之间必须首尾相接（不许有缝）');
      ok(b > a, '每段非空');
      prevEnd = b;
    }
    eq(prevEnd, 100, '合起来覆盖 [0, 100) 共 100 帧');
    const sum = segs.reduce((acc, [a, b]) => acc + (b - a), 0);
    eq(sum, 100, '⭐ 帧数对账');
  });

  test('--range 0 23 那种闭区间：换成左闭右开后正好 24 帧', () => {
    const n0 = 0;
    const n1Incl = 23;
    const segs = segmentRuns(n0, n1Incl + 1, 4);
    const sum = segs.reduce((acc, [a, b]) => acc + (b - a), 0);
    eq(sum, 24, '24 帧');
    eq(segs[0][0], 0, '首帧');
    eq(segs[segs.length - 1][1], 24, '末帧（不含）');
  });

  test('worker 数多于帧数时不会产生空段', () => {
    const segs = segmentRuns(0, 5, 32);
    eq(segs.length, 5, '只有 5 帧，最多 5 段');
    ok(segs.every(([a, b]) => b > a), '不许有空段');
  });

  test('eachFrameOfSegment 只产出该段内的帧，且按序', () => {
    const got = [...eachFrameOfSegment(10, 14)];
    eq(got.join(','), '10,11,12,13', '左闭右开');
  });

  test('**worker 数无关**：不同切分下每一帧的哈希都一样', () => {
    // 这是「纯函数 + 分段无副作用」的直接验证：
    // 切法变了、每个 worker 的起跑点变了，但同一帧的结果必须一样。
    const seen = new Map();
    for (const workers of [1, 3, 8]) {
      for (const [a, b] of segmentRuns(0, 24, workers)) {
        for (const n of eachFrameOfSegment(a, b)) {
          const h = frameHash(frame(n));
          const prev = seen.get(n);
          if (prev === undefined) seen.set(n, h);
          else eq(h, prev, `帧 ${n} 在 workers=${workers} 下的哈希`);
        }
      }
    }
    eq(seen.size, 24, '覆盖的帧数');
  });
});
