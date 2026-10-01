/**
 * film/test/timeline.test.js — ⭐ 时间线断言护栏的验收（施工说明 §6 Phase 0）。
 *
 * 验收要求：**人为构造「有空洞」「有重叠」「未覆盖到 END_T」三种坏时间线，
 * `finalize()` 各自报错；正确时间线通过**。
 *
 * 而且报错必须**能定位**（施工说明 §7.2 的好例子）：带具体时间点、帧数、相邻两段的标签。
 * 所以这里不只断言「抛了」，还断言错误文本里出现了这些字段。
 */

import { END_T, FPS, FRAME_COUNT, timeAt } from '../engine/clock.js';
import * as tl from '../engine/timeline.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

/** 一段什么都不做的绘制函数。 */
const noop = () => {};

describe('timeline · 正确时间线', () => {
  test('三段首尾相接覆盖 [0, END_T] 时 finalize 通过', () => {
    tl.reset();
    const a = timeAt(144); // 0–143 = 6.00 s
    const b = timeAt(251); // 144–250
    const c = timeAt(FRAME_COUNT); // 251–4740
    tl.add(0, a, noop, { label: '01 / INJECT' });
    tl.add(a, b, noop, { label: '02 / THINK' });
    tl.add(b, c, noop, { label: '03 / OUTPUT' });
    const table = tl.finalize();
    eq(table.length, 3, '语段数');
    eq(tl.assertFrameAccount(FRAME_COUNT, table), FRAME_COUNT, '帧数对账');
  });

  test('登记顺序乱也没关系（finalize 自己排序）', () => {
    tl.reset();
    tl.add(timeAt(144), timeAt(251), noop, { label: 'B' });
    tl.add(0, timeAt(144), noop, { label: 'A' });
    tl.add(timeAt(251), END_T, noop, { label: 'C' });
    const table = tl.finalize();
    eq(table.map((s) => s.label).join(','), 'A,B,C', '排序后的标签顺序');
  });

  test('引子三拍的真实边界（帧 0/144/251/419 与 4741）', () => {
    tl.reset();
    // 引子只覆盖开头 419 帧，所以 finalize 时要显式给 range —— 别假装它覆盖全片
    tl.add(timeAt(0), timeAt(144), noop, { label: '01 / 注入' });
    tl.add(timeAt(144), timeAt(251), noop, { label: '02 / 思考' });
    tl.add(timeAt(251), timeAt(419), noop, { label: '03 / 输出' });
    const table = tl.finalize({ start: 0, end: timeAt(419) });
    eq(table.length, 3, '语段数');
    eq(tl.assertFrameAccount(419, table), 419, '引子帧数 = 419');
  });
});

describe('timeline · 三种坏时间线必须各自报错', () => {
  test('空洞：报 gap，带具体时间点、帧数与相邻两段标签', () => {
    tl.reset();
    tl.add(0, timeAt(100), noop, { label: '03 / VERSE_B' });
    tl.add(timeAt(102), END_T, noop, { label: '04 / CHORUS' });
    const err = throws(() => tl.finalize(), '中间有 2 帧空洞');
    contains(err.message, 'GAP', '要说是 gap');
    contains(err.message, timeAt(100).toFixed(6), '要带空洞起点（= 前一段的 end）');
    contains(err.message, timeAt(102).toFixed(6), '要带空洞终点（= 后一段的 start）');
    contains(err.message, '2 帧', '要换算成帧数');
    contains(err.message, '03 / VERSE_B', '要带前一段的标签');
    contains(err.message, '04 / CHORUS', '要带后一段的标签');
  });

  test('重叠：报 overlap，带重叠区间与两段标签', () => {
    tl.reset();
    tl.add(0, timeAt(100), noop, { label: '03 / VERSE_B' });
    tl.add(timeAt(98), END_T, noop, { label: '04 / CHORUS' });
    const err = throws(() => tl.finalize(), '两段重叠 2 帧');
    contains(err.message, 'OVERLAP', '要说是 overlap');
    contains(err.message, timeAt(98).toFixed(6), '要带重叠起点');
    contains(err.message, timeAt(100).toFixed(6), '要带重叠终点');
    contains(err.message, '2 帧', '要换算成帧数');
    contains(err.message, '03 / VERSE_B', '要带前一段的标签');
    contains(err.message, '04 / CHORUS', '要带后一段的标签');
  });

  test('未覆盖到 END_T：报尾部缺口', () => {
    tl.reset();
    tl.add(0, timeAt(FRAME_COUNT - 10), noop, { label: '07 / OUTRO' });
    const err = throws(() => tl.finalize(), '尾部少了 10 帧');
    contains(err.message, timeAt(FRAME_COUNT - 10).toFixed(6), '要带断点时间');
    contains(err.message, END_T.toFixed(6), '要带期望终点');
    contains(err.message, '10 帧', '要报缺了多少帧');
    contains(err.message, '07 / OUTRO', '要带最后一个语段的标签');
  });

  test('起点不是 0：报头部缺口', () => {
    tl.reset();
    tl.add(timeAt(1), END_T, noop, { label: '01 / INJECT' });
    const err = throws(() => tl.finalize(), '开头少了 1 帧');
    contains(err.message, '起点', '要说是起点没覆盖');
    contains(err.message, '1 帧', '要报缺了多少帧');
  });

  test('空表：报「没有任何语段」', () => {
    tl.reset();
    const err = throws(() => tl.finalize(), '一段都没登记');
    contains(err.message, '空', '要说清楚是空的');
  });

  test('段长不是整数帧：报出来（切点落不到帧边界）', () => {
    tl.reset();
    tl.add(0, 1.0, noop, { label: 'BADLEN' }); // 1.0 s = 24 帧 → 合法
    tl.add(1.0, END_T, noop, { label: 'REST' });
    tl.finalize();
    tl.reset();
    tl.add(0, 0.5, noop, { label: 'HALF' }); // 0.5 s = 12 帧 → 合法
    tl.add(0.5, END_T, noop, { label: 'REST' });
    tl.finalize();
    tl.reset();
    tl.add(0, 0.51, noop, { label: 'ODD' }); // 0.51 s = 12.24 帧 → 非法
    tl.add(0.51, END_T, noop, { label: 'REST' });
    const err = throws(() => tl.finalize(), '0.51 s 不是整数帧');
    contains(err.message, 'ODD', '要带出问题的段标签');
    contains(err.message, '整数帧', '要说清楚是整帧问题');
  });

  test('帧数对账失败时逐段列出明细', () => {
    tl.reset();
    tl.add(0, timeAt(100), noop, { label: 'A' });
    tl.add(timeAt(100), timeAt(200), noop, { label: 'B' });
    const table = tl.finalize({ start: 0, end: timeAt(200) });
    const err = throws(() => tl.assertFrameAccount(FRAME_COUNT, table), '只覆盖 200 帧');
    contains(err.message, '帧数对账失败', '要说清是哪条护栏');
    contains(err.message, '200', '要报实际帧数');
    contains(err.message, String(FRAME_COUNT), '要报期望帧数');
    contains(err.message, 'A', '要逐段列明细');
    contains(err.message, 'B', '要逐段列明细');
  });
});

describe('timeline · 整数帧边界是唯一的切点', () => {
  test('timeAt(n) 是 n 帧的起点，且 n = round(timeAt(n) * FPS) 回得来', () => {
    for (const n of [0, 1, 143, 144, 250, 251, 418, 419, FRAME_COUNT - 1, FRAME_COUNT]) {
      const t = timeAt(n);
      eq(Math.round(t * FPS), n, `帧 ${n} 的往返换算`);
    }
  });

  test('419 帧是开词帧：下一帧正好是 17.4583… s', () => {
    eq(Math.round(timeAt(419) * FPS), 419, '开词帧号');
    ok(Math.abs(timeAt(419) - 419 / 24) < 1e-12, 'timeAt 就是 n/FPS');
  });
});
