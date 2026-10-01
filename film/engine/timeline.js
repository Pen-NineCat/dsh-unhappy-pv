/**
 * film/engine/timeline.js — 语段表 + `finalize()` 断言（`AGENTS.md` §8 的 ⭐ 护栏之一）。
 *
 * 约定
 * ----
 * - 语段是**半开区间** `[start, end)`，单位是**秒**；`end - start` 必须是整数帧的时长
 *   （`(end - start) * FPS` 是整数），否则切点落不到整帧上，帧号唯一主键就破了。
 * - 语段必须**首尾相接**、按时间升序、覆盖 `[START_T, END_T]`，既不能有空洞也不能有重叠。
 * - `add()` 只管登记；`finalize()` 才断言。登记顺序随便，`finalize()` 会自己排序。
 *
 * 报错质量（施工说明 §7.2）
 * ------------------------
 * 护栏的价值全看报错好不好定位，所以错误信息必须带**具体时间点 + 相邻两段的标签**：
 *
 * ```
 * timeline GAP at t=44.030000..44.120000 (0.090 s = 2.167 帧 ≈ 2 帧)
 *   previous segment ends at 44.030000  ("03 / VERSE_B")
 *   next     segment starts at 44.120000  ("04 / CHORUS")
 *   hint: ...
 * ```
 *
 * 不要出现 `Error: timeline gap` 这种一句话。
 *
 * @typedef {Object} Segment
 * @property {number} start 起点，秒（含）
 * @property {number} end   终点，秒（不含）
 * @property {string} label 人类可读标签，如 `"03 / VERSE_B"`；错误信息会带上它
 * @property {Function} fn  该段的绘制函数，签名 `(ctx, t, prev) => void`（Phase 4 起才有内容）
 */

import { FPS, START_T, END_T } from './clock.js';

/** @type {Segment[]} */
const segments = [];
let frozen = false;

/**
 * 登记一段。
 * @param {number} start 起点，秒
 * @param {number} end   终点，秒（不含）
 * @param {Function} fn  绘制函数
 * @param {{label?: string}} [opts]
 * @returns {Segment} 登记进去的那条（已冻结的对象）
 */
export function add(start, end, fn, opts = {}) {
  if (frozen) {
    throw new Error('timeline 已 finalize()，不能再 add()；请在构建期把语段登记完');
  }
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`timeline add(): start/end 必须是有限数，收到 start=${start} end=${end}`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`timeline add(): fn 必须是函数（段 "${opts.label ?? '(未命名)'}"）`);
  }
  /** @type {Segment} */
  const seg = { start, end, fn, label: opts.label ?? `(未命名 ${start}–${end})` };
  segments.push(seg);
  return seg;
}

/** 清空登记表（测试用；正常流程不用）。 */
export function reset() {
  segments.length = 0;
  frozen = false;
}

/**
 * 断言三条 ⭐ 护栏之一，然后把语段表冻结。
 *
 * - 升序、无重叠、无空洞、覆盖 `[START_T, END_T]`
 * - 每段的时长必须是整数帧
 *
 * @param {{start?: number, end?: number}} [range] 覆盖范围，默认 `[START_T, END_T]`
 * @returns {readonly Segment[]} 排序后的语段表（冻结）
 * @throws {Error} 违反上述任一条时抛出，错误信息带具体时间点与相邻语段
 */
export function finalize(range = {}) {
  const lo = range.start ?? START_T;
  const hi = range.end ?? END_T;

  if (segments.length === 0) {
    throw new Error(
      `timeline 是空的：没有任何语段，无法覆盖 [${lo}, ${hi}]\n` +
        `  hint: 至少 add(${lo}, ${hi}, fn, { label: '…' }) 一段`,
    );
  }

  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);

  // 1) 每段的时长必须落在整帧上（否则切点不在帧边界）
  for (const s of sorted) {
    const frames = (s.end - s.start) * FPS;
    if (Math.abs(frames - Math.round(frames)) > 1e-6) {
      throw new Error(
        `timeline 段 "${s.label}" 的时长不是整数帧：` +
          `t=${fmt(s.start)}..${fmt(s.end)} = ${fmt(s.end - s.start)} s = ${fmt(frames)} 帧\n` +
          `  hint: 帧边界是 k/${FPS}；把 start/end 挪到最近的帧边界上`,
      );
    }
    if (s.end <= s.start) {
      throw new Error(
        `timeline 段 "${s.label}" 的 end <= start：t=${fmt(s.start)}..${fmt(s.end)} ` +
          `(${fmt(s.end - s.start)} s)\n  hint: 空段没有意义，删掉它或把 end 加大`,
      );
    }
  }

  // 2) 起点必须正好是 lo（覆盖从片头开始）
  if (Math.abs(sorted[0].start - lo) > 1e-9) {
    throw new Error(
      `timeline 起点没有覆盖 t=${fmt(lo)}：` +
        `第一个语段是 "${sorted[0].label}"，从 t=${fmt(sorted[0].start)} 开始\n` +
        `  缺了前面的 ${fmtSpan(sorted[0].start - lo)}\n` +
        `  hint: 补一段 [${fmt(lo)}, ${fmt(sorted[0].start)})`,
    );
  }

  // 3) 相邻两段：先查重叠，再查空洞（两者都能出，只报一个，但要说清是哪一种）
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const delta = next.start - prev.end;

    if (delta < -1e-9) {
      throw new Error(
        `timeline OVERLAP at t=${fmt(next.start)}..${fmt(prev.end)} (${fmtSpan(-delta)})\n` +
          `  previous segment ends at ${fmt(prev.end)}  ("${prev.label}")\n` +
          `  next     segment starts at ${fmt(next.start)}  ("${next.label}")\n` +
          `  hint: 把前一段的 end 收成 ${fmt(next.start)}，或把后一段的 start 推到 ${fmt(prev.end)}`,
      );
    }
    if (delta > 1e-9) {
      throw new Error(
        `timeline GAP at t=${fmt(prev.end)}..${fmt(next.start)} (${fmtSpan(delta)})\n` +
          `  previous segment ends at ${fmt(prev.end)}  ("${prev.label}")\n` +
          `  next     segment starts at ${fmt(next.start)}  ("${next.label}")\n` +
          `  hint: 补一段 [${fmt(prev.end)}, ${fmt(next.start)})，或把两段接上`,
      );
    }
  }

  // 4) 终点必须正好是 hi（覆盖到片尾）
  const last = sorted[sorted.length - 1];
  if (Math.abs(last.end - hi) > 1e-9) {
    const delta = hi - last.end;
    throw new Error(
      `timeline 终点没有覆盖 t=${fmt(hi)}：` +
        `最后一个语段是 "${last.label}"，到 t=${fmt(last.end)} 就断了\n` +
        `  缺了后面的 ${fmtSpan(delta)}\n` +
        `  hint: 补一段 [${fmt(last.end)}, ${fmt(hi)})`,
    );
  }

  frozen = true;
  return Object.freeze(sorted.map((s) => Object.freeze(s)));
}

/**
 * 取排序后的语段表（不 finalize，只排序）。给「只想知道边界」的调用方用。
 * @returns {Segment[]}
 */
export function list() {
  return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * 帧号 → 该帧所属语段。没有登记任何语段或不在覆盖范围内时返回 `null`。
 * @param {number} n 帧号
 * @returns {?Segment}
 */
export function segmentAtFrame(n) {
  const t = n / FPS;
  for (const s of list()) {
    if (t >= s.start && t < s.end) return s;
  }
  return null;
}

/**
 * ⭐ 帧数对账（`AGENTS.md` §8）：各段区间求和必须等于期望总帧数。
 * @param {readonly Segment[]} [table] 默认取最后的 `finalize()` 结果
 * @returns {{frames: number, perSegment: Array<{label: string, frames: number}>}}
 */
export function accountFrames(table) {
  const segs = table ?? frozenSegments();
  const perSegment = segs.map((s) => ({ label: s.label, frames: Math.round((s.end - s.start) * FPS) }));
  const frames = perSegment.reduce((a, s) => a + s.frames, 0);
  return { frames, perSegment };
}

/**
 * 帧数对账断言版本：不等于期望帧数就抛，并逐段列出。
 * @param {number} expected 期望总帧数（通常 `FRAME_COUNT`）
 * @param {readonly Segment[]} [table]
 */
export function assertFrameAccount(expected, table) {
  const { frames, perSegment } = accountFrames(table);
  if (frames !== expected) {
    const lines = perSegment.map((s) => `    ${String(s.frames).padStart(5)} 帧  ${s.label}`).join('\n');
    throw new Error(
      `帧数对账失败：各段求和 ${frames} ≠ 期望 ${expected}（差 ${frames - expected} 帧）\n` +
        `  各段明细：\n${lines}\n` +
        `  hint: 帧数由 clock.js 的 END_T/FPS 决定；要改就改 clock.js，别改这里的段边界`,
    );
  }
  return frames;
}

/** @returns {readonly Segment[]} */
function frozenSegments() {
  if (!frozen) {
    throw new Error('timeline 还没 finalize()：先跑 finalize() 再对账（否则空洞/重叠都没查）');
  }
  return /** @type {readonly Segment[]} */ (list());
}

/**
 * 把秒格式化成固定 6 位小数，便于报错信息里对齐比较。
 * @param {number} v
 * @returns {string}
 */
function fmt(v) {
  return v.toFixed(6);
}

/**
 * 把秒数换算成帧数并格式化：整数帧显示成 `2 帧`，非整数显示成 `2.167 帧`
 * （施工说明 §7.2：报错要给出**帧数**，人都按帧想事）。
 * @param {number} seconds
 * @returns {string}
 */
function fmtFrames(seconds) {
  const f = seconds * FPS;
  const r = Math.round(f);
  const text = Math.abs(f - r) < 1e-6 ? String(r) : f.toFixed(3);
  return `${text} 帧`;
}

/**
 * 秒 + 帧数写成一段，报错信息里到处要用。
 * @param {number} seconds
 * @returns {string} 形如 `0.083333 s = 2 帧`
 */
function fmtSpan(seconds) {
  return `${fmt(seconds)} s = ${fmtFrames(seconds)}`;
}
