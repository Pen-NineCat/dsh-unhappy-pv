/**
 * film/engine/content.js — **时间线的唯一注册点**。
 *
 * `film/engine/frame.js` 不 import 任何 `content/` 的东西：它只查已经登记好的语段表。
 * 这样「换一段内容」= 改这一个文件，而不是在引擎里改分支。
 *
 * 现在的状态（2026-10-01）
 * ----------------------
 * 登记的是 **Phase 3 的管线自检**（`content/example.js`）：整片一段，
 * 边界落在**真实的引子拍点**上（帧 0 / 144 / 251 / 419），这样 ⭐ 帧数对账
 * 从一开始就在真边界上跑，而不是在随手编的数字上跑。
 *
 * ⚠️ **引子的画面内容另有其人负责**（`design-options.md` 顶部 T3）。
 * 他的段函数一旦就位，把下面的 `drawExample` 换掉即可 —— 段边界不用动。
 *
 * 为什么是四段而不是三段
 * ----------------------
 * `design-options.md` §1：引子是三拍 `0–143 / 144–250 / 251–418`，
 * 而**第 419 帧是开词帧**（`Every day we talk a little less`），属于 Verse 1。
 * 所以从 419 帧起是「引子之后」的占位段，边界必须落在 419 而不是随便一个数。
 */

import { END_T, FRAME_COUNT, timeAt } from './clock.js';
import { add, assertFrameAccount, finalize } from './timeline.js';
import { drawExample } from '../content/example.js';

/** 引子三拍的边界（帧号）。 */
export const PRELUDE_MARKS = { inject: 0, think: 144, output: 251, firstLyric: 419 };

/** @type {?readonly import('./timeline.js').Segment[]} */
let built = null;

/**
 * 建表并 `finalize()`（含三条断言：升序 / 无空洞 / 无重叠 / 覆盖 `[0, END_T]` + 帧数对账）。
 *
 * 幂等：重复调用返回同一张表，不会重复 `add()`。
 * @returns {readonly import('./timeline.js').Segment[]}
 */
export function buildTimeline() {
  if (built) return built;

  const m = PRELUDE_MARKS;
  add(timeAt(m.inject), timeAt(m.think), drawExample, { label: '01 / INJECT（引子第 1 拍）' });
  add(timeAt(m.think), timeAt(m.output), drawExample, { label: '02 / THINK（引子第 2 拍）' });
  add(timeAt(m.output), timeAt(m.firstLyric), drawExample, { label: '03 / OUTPUT（引子第 3 拍）' });
  add(timeAt(m.firstLyric), timeAt(FRAME_COUNT), drawExample, { label: '04 / PRELUDE_AFTER（占位，待设计）' });

  const table = finalize({ start: 0, end: END_T });
  assertFrameAccount(FRAME_COUNT, table);
  built = table;
  return table;
}
