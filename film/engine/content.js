/**
 * film/engine/content.js — **时间线的唯一注册点**。
 *
 * `film/engine/frame.js` 不 import 任何 `content/` 的东西：它只查已经登记好的语段表。
 * 这样「换一段内容」= 改这一个文件，而不是在引擎里改分支。
 *
 * 现在的状态（2026-10-01，T4/T5 之后）
 * --------------------------------
 * 画面轴四个大段，中段与后段仍是 **Phase 3 的管线自检**（`content/example.js`）：
 *
 * | 段 | 画什么 |
 * |---|---|
 * | `[0, 419)` 引子 | `content/prelude.js` = 自检画面占位 + `content/panels.js` 的右列骨架 |
 * | `[419, 1903)` 第一幕 | `content/act1.js` = 骨架 + `content/memory.js` 的记录 + `content/cursor.js` 的**她** |
 * | `[1903, 2454)` 幕间 | ⚠️ 还是自检画面（T7/幕间未设计） |
 * | `[2454, 4741)` 第二幕 | ⚠️ 还是自检画面（第二幕未设计） |
 *
 * ⚠️ 引子里的**网页层**（`film/pages/`）已经是真内容；引子剩下的画布侧
 * （5 层层堆叠的占位背景）是画面规格 §1.4 的 ⛔#3/#4（**未定**），所以仍是占位。
 *
 * 为什么段边界是这样
 * ------------------
 * `AGENTS.md` §2 规则 13：**段区间一律半开 `[start, end)`，边界帧归后一段**，
 * 而且**画面轴与声音轴是两张独立的段表**。引子 `[0,419)` = 419 帧；
 * **第 419 帧是开词帧**（`Every day we talk a little less`），它属于第一幕。
 */

import { END_T, FRAME_COUNT, timeAt } from './clock.js';
import { add, assertFrameAccount, finalize } from './timeline.js';
import { drawAct1 } from '../content/act1.js';
import { drawExample } from '../content/example.js';
import { drawPrelude } from '../content/prelude.js';

/**
 * 引子三拍的边界（帧号）。这是**页面侧的拍点**（`film/pages/intro.js` 的 `MARKS` 与它对齐），
 * **不再**是时间线的段边界 —— 时间线按画面规格的**大段**登记（见 `ACT_MARKS`）。
 */
export const PRELUDE_MARKS = { inject: 0, think: 144, output: 251, firstLyric: 419 };

/**
 * **画面轴**的段边界（半开 `[start, end)`；`AGENTS.md` §2 规则 13）。
 *
 * 作者 2026-10-01 拍板（A6），**两张表分开写清楚**：
 *
 * ```
 * 画面轴：[0,419) 引子 → [419,1903) 第一幕 → [1903,2454) 幕间（含尾巴）→ [2454,4741) 第二幕·起
 * 声音轴：[0,419) 器乐 → [419,2366) 第一半（男声独唱）        → [2366,4741) 第二半（对唱）
 * ```
 *
 * ⭐ 求和（画面轴）：`419 + 1484 + 551 + 2287 = 4741`，相邻段首尾相接。
 *
 * ⚠️ **两条轴在 `[2366, 2454)` 错位**（§2.3）：那 88 帧里**声音已经进入第二幕**（她的前两句 = 画外音），
 * 而**画面还在幕间**（世界已经缩成窗口、备份加载与重建继续）。
 * → 这不是同一轴上的重叠，是**两条轴之间**的错位，各轴的"无重叠无空洞"照常成立。
 *
 * 📌 本文件是**画面轴**。声音轴（第二张段表）是另一张表，**还没建**（🚧，
 * 见 `AGENTS.md` §5 与记录 31）；建的时候用它自己的 `2366`，不要来改这里。
 */
export const ACT_MARKS = { prelude: 0, act1: 419, interlude: 1903, act2: 2454 };

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

  const m = ACT_MARKS;
  // 引子画 `drawPrelude`（自检占位 + 右列在帧 350–418 长出来），
  // 第一幕画 `drawAct1`（三格骨架 + memory 的记录 + 她）。两者共用 `content/panels.js`
  // 的右列代码——所以"格子在拉远途中长出来"与"第一幕的三格"是同一份几何。
  add(timeAt(m.prelude), timeAt(m.act1), drawPrelude, {
    label: '01 / 引子（占位背景 + 右列在帧 350–418 长出来）',
  });
  add(timeAt(m.act1), timeAt(m.interlude), drawAct1, {
    label: '02 / 第一幕（三格 + memory 两条记录 + 她那只鼠标）',
  });
  add(timeAt(m.interlude), timeAt(m.act2), drawExample, {
    label: '03 / 幕间（未设计，仍是 Phase 3 的管线自检画面）',
  });
  add(timeAt(m.act2), timeAt(FRAME_COUNT), drawExample, {
    label: '04 / 第二幕（未设计，占位）',
  });

  const table = finalize({ start: 0, end: END_T });
  assertFrameAccount(FRAME_COUNT, table);
  built = table;
  return table;
}
