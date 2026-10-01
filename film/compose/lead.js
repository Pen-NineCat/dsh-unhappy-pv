/**
 * film/compose/lead.js — **主导权表（LEAD）**：每一时刻谁是主角。
 *
 * 参考项目的做法（施工说明 §6 Phase 6 第 4 条）我们沿用，但**用显式接口**：
 * 非主角的层 alpha 降到 `NON_LEAD_ALPHA`（约 0.42），切换时做 `FADE_S`（0.25 s）的
 * 交叉淡化。这不是猴补丁 —— 表是数据，`leadAlphaAt(t)` 是纯函数。
 *
 * 为什么要「主导权」这件事：`design-options.md` 的读法是
 * **`dsh` = 我（男声）、`user` = 用户（女声）**，而第一幕 100% 是 dsh 独唱
 * （见 `design-options.md` §1.5 的声部分布表）。所以「谁在场、谁是主角」本身就是叙事，
 * 它必须能由 `t` 反推，**不能藏状态**（`AGENTS.md` §2 规则 6）。
 *
 * ⚠️ 下表的**具体时刻**是占位：引子之后的画面结构尚未拍板
 * （`design-options.md` §0.6 的「还有一条不是拍板而是没设计」）。
 * 但**接口与语义**是最终的 —— 换内容只需要换这张表。
 */

/** 非主角层的 alpha（参考项目沿用值）。 */
export const NON_LEAD_ALPHA = 0.42;

/** 交叉淡化时长（秒）—— 参考项目 0.25 s。 */
export const FADE_S = 0.25;

/** 主角是谁：`'dsh'`（我/男声）或 `'user'`（用户/女声）。 */
export const TRACKS = /** @type {const} */ (['dsh', 'user']);

/**
 * @typedef {Object} LeadSpan
 * @property {number} from 起始帧（含）
 * @property {number} to 结束帧（**不含**）
 * @property {'dsh'|'user'} lead 这段里谁是主角
 * @property {string} label 人类可读标签（错误信息会带它）
 */

/**
 * 占位的主导权表。
 *
 * 依据（`design-options.md` §1.5）：
 * - **第一幕 419–1903 是 dsh 独唱** → 这一段 lead 一直是 `dsh`
 * - **接缝 1903–2366** 是器乐，画面在两半之间 → 用 `dsh` 过渡到 `user`
 * - **第二幕 2366 起是对唱**，女声首次出现在 `n=2366`
 *
 * 所以下面这三段**不是随便编的**，它们落在真实的幕边界上；以后再细分成逐句表。
 * @type {readonly LeadSpan[]}
 */
export const LEAD_TABLE = Object.freeze([
  Object.freeze({ from: 0, to: 419, lead: /** @type {'dsh'} */ ('dsh'), label: '引子（dsh 早就在跑，还没开口）' }),
  Object.freeze({ from: 419, to: 1903, lead: /** @type {const} */ ('dsh'), label: '第一幕·独唱（dsh）' }),
  Object.freeze({ from: 1903, to: 2366, lead: /** @type {const} */ ('dsh'), label: '接缝·器乐（主导权交给 user）' }),
  Object.freeze({ from: 2366, to: 4741, lead: /** @type {const} */ ('user'), label: '第二幕·对唱（user 为主）' }),
]);

/**
 * 校验主导权表（每段非空、首尾相接、覆盖 `[0, FRAME_COUNT)`、主角名合法）。
 *
 * 这是 ⭐「时间线断言」在主导权表上的版本 —— 用同一个纪律，别靠人眼。
 * @param {readonly LeadSpan[]} [table]
 * @param {number} [frameCount]
 * @throws {Error} 违反时抛出，错误信息带具体帧号与相邻两段标签
 */
export function assertLeadTable(table = LEAD_TABLE, frameCount = 4741) {
  if (table.length === 0) throw new Error('LEAD 表是空的');
  const sorted = [...table].sort((a, b) => a.from - b.from);
  for (const s of sorted) {
    if (!TRACKS.includes(s.lead)) {
      throw new Error(`LEAD 段 "${s.label}" 的主角名 "${s.lead}" 不合法（只允许 ${TRACKS.join(' / ')}）`);
    }
    if (!(s.to > s.from)) {
      throw new Error(`LEAD 段 "${s.label}" 的 to <= from（${s.from}..${s.to}）`);
    }
  }
  if (sorted[0].from !== 0) {
    throw new Error(
      `LEAD 表没有覆盖帧 0：第一段 "${sorted[0].label}" 从 ${sorted[0].from} 开始\n` +
        `  hint: 补一段 [0, ${sorted[0].from})`,
    );
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (next.from !== prev.to) {
      const kind = next.from > prev.to ? 'GAP' : 'OVERLAP';
      throw new Error(
        `LEAD 表 ${kind} at n=${Math.min(prev.to, next.from)}..${Math.max(prev.to, next.from)}\n` +
          `  previous ends   at n=${prev.to}  ("${prev.label}")\n` +
          `  next     starts at n=${next.from}  ("${next.label}")\n` +
          `  hint: LEAD 表必须首尾相接、覆盖 [0, ${frameCount})`,
      );
    }
  }
  if (sorted[sorted.length - 1].to !== frameCount) {
    const last = sorted[sorted.length - 1];
    throw new Error(
      `LEAD 表没有覆盖到帧 ${frameCount}：最后一段 "${last.label}" 到 ${last.to} 就断了\n` +
        `  hint: 补一段 [${last.to}, ${frameCount})`,
    );
  }
  return true;
}

/**
 * 这一帧属于哪一段。
 * @param {number} n 帧号
 * @param {readonly LeadSpan[]} [table]
 * @returns {LeadSpan}
 */
export function leadSpanAt(n, table = LEAD_TABLE) {
  for (const s of table) {
    if (n >= s.from && n < s.to) return s;
  }
  // 越界帧钳制到最近的一段（渲染器已经在别处拦过越界；这里给出可用的默认值）
  return n < table[0].from ? table[0] : table[table.length - 1];
}

/**
 * **某个轨道在某一帧的 alpha** —— 纯函数，这就是「主导权」的全部实现。
 *
 * 规则（一条就够，比按相邻两段各判一次更稳）：
 *
 * 1. 先看本帧所在段的 `lead`：本轨道是主角 → 基准 `1`，不是 → 基准 `low`（`NON_LEAD_ALPHA`）。
 * 2. 再看**本段末尾**的切换：窗口是 `[span.to - FADE_S·FPS, span.to]`（**结束在边界上**），
 *    在窗口内线性地把 alpha 从基准拉向「下一段的主角是不是本轨道」对应的值。
 *    所以旧主角在**边界前**降完、新主角在边界前升完 —— 边界那一帧两边都已经到位，
 *    **不会出现「两条轨道同时是 1」的突然变亮**。
 *
 * ⚠️ 两条都是踩过的坑（2026-10-01，都由测试抓出来）：
 * 1. 最早按「相邻两段各判一次」写，结果在边界帧两条轨道都等于 1（画面突然亮一下）。
 * 2. `k` 必须 clamp 到 `[0,1]`，否则窗口外会外推出 `alpha > 1` 或反号。
 * @param {number} n 帧号
 * @param {'dsh'|'user'} track
 * @param {{table?: readonly LeadSpan[], fps?: number, fadeS?: number, nonLeadAlpha?: number}} [opts]
 * @returns {number} `NON_LEAD_ALPHA .. 1`
 */
export function leadAlphaAt(n, track, opts = {}) {
  const table = opts.table ?? LEAD_TABLE;
  const fps = opts.fps ?? 24;
  const fadeS = opts.fadeS ?? FADE_S;
  const low = opts.nonLeadAlpha ?? NON_LEAD_ALPHA;
  const span = leadSpanAt(n, table);

  const base = span.lead === track ? 1 : low;

  const idx = table.indexOf(span);
  const next = idx >= 0 && idx < table.length - 1 ? table[idx + 1] : null;
  const fadeFrames = Math.max(0, fadeS * fps);
  if (!next || fadeFrames === 0) return base;

  // 窗口 [span.to - fadeFrames, span.to]，**结束在边界上**
  const k0 = (n - (span.to - fadeFrames)) / fadeFrames;
  const k = k0 < 0 ? 0 : k0 > 1 ? 1 : k0;
  if (k <= 0) return base;

  const target = next.lead === track ? 1 : low;
  return base + (target - base) * k;
}

/**
 * 一次算出一条轨道在一个帧区间上的 alpha 序列（出片日志/校验用）。
 * @param {number} n0 含 @param {number} n1 不含
 * @param {'dsh'|'user'} track
 * @returns {number[]}
 */
export function leadAlphaRange(n0, n1, track) {
  const out = [];
  for (let n = n0; n < n1; n++) out.push(leadAlphaAt(n, track));
  return out;
}

/**
 * 一帧里**同时在场**的轨道（alpha > 0），按 alpha 降序。
 * 「同一时刻在场通道 ≤ 3 条」是 `design-options.md` §0 的全局硬约束，用它可以数。
 * @param {number} n
 * @returns {{track: 'dsh'|'user', alpha: number}[]}
 */
export function tracksAt(n) {
  return TRACKS.map((track) => ({ track, alpha: leadAlphaAt(n, track) }))
    .filter((x) => x.alpha > 0)
    .sort((a, b) => b.alpha - a.alpha);
}
