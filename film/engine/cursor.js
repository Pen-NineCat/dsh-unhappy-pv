/**
 * film/engine/cursor.js — **她本人**：全片唯一的一只鼠标箭头（画面规格 §三）。
 *
 * ## 规格说了什么
 *
 * > ⭐ **她本人 = 一个鼠标箭头（全片唯一）。没有手，没有任何身体。**
 * > → **遵循鼠标箭头的一切**：形状随所在控件变化（界面上是箭头、**输入框上是 I-beam**、可点处是手型）；
 * > → 移动遵守真实鼠标的运动特性（加减速、过冲、微小抖动），**不是匀速直线**。
 * > → **不占任何格子**：它在三格**之上**（= 角色层，独立画布）。
 * > **鼠标路径由脚本写**（**不录制**）。
 *
 * 所以这个模块**只算位置与形状**（纯函数、无绘制），画由 `film/content/cursor.js` 干。
 * 分开的理由和 `layout.js` / `panels.js` 一样：位置是要被两个地方用的
 * （绘制要用它，探针与测试要拿它做断言），各算一遍迟早差一点。
 *
 * ## 路径契约（§三 的表，逐条对应到常数）
 *
 * | 项 | 规定 | 这里是谁 |
 * |---|---|---|
 * | 来源 | **纯程序化（M2）**：只保证**落点与时刻正确**；路径由"从 A 到 B"生成；**不手工标路径点** | `data/cursor/keypoints.json` + {@link pathAt} |
 * | 缓动 | 加减速（ease-in-out）+ **一次轻微过冲** | `easeInOutCubic` + {@link OVERSHOOT} |
 * | 抖动 | ⭐**必须低频平滑，不能逐帧独立随机** —— 每 6–10 帧换一个偏移目标、之间插值，幅度 **1–3 px**；`frameRng(seed, n)` 播种 | {@link JITTER_STEP} / {@link JITTER_MIN} / {@link JITTER_MAX} / {@link jitterAt} |
 * | 形状 | **不采**：由 `(x,y)` 落在哪个控件推断 | `layout.js` 的 `cursorShapeAt()` |
 * | 焦点 | **不需要独立的焦点表** | 不实现（谁在动作谁有焦点，由逐句表决定） |
 * | 提交 | ✅ 关键点清单进 `data/cursor/` | `data/cursor/keypoints.json` |
 *
 * ## 确定性（`AGENTS.md` §2 规则 6/7）
 *
 * `cursorAt(n)` 是**纯函数**：关键点表在 import 时读一次（配置，不是状态），
 * 抖动走 `frameRng(seed, k)`（按"抖动窗口"播种，不是按帧独立随机），
 * 全程没有 `Math.random()`、没有跨帧状态。
 *
 * ## 这一版**没做**的（如实记账）
 *
 * - **引子（帧 0–419）没有鼠标**：§2.1 的画面清单里没有它，所以 `cursorAt()` 在
 *   第一个关键点之前返回 `visible: false`。要"她一直都在"（O1 的载体②）就得给引子也排关键点 ——
 *   那是**内容改动**（会改已验收的引子），所以留成待拍板项而不是自己加。
 * - T6/T8/T7（`[802, …)`）的关键点还没写：在那之前她停在最后一个锚点上（仍有低频抖动）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FPS, H, W, frameAt } from './clock.js';
import { ANCHORS, cursorShapeAt } from './layout.js';
import { frameRng } from '../kit/noise.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根（`film/engine/` 往上两层）。 */
const ROOT = join(HERE, '..', '..');

/** 关键点清单的路径（**作者可改**，见文件头）。 */
export const KEYPOINTS_FILE = join(ROOT, 'data', 'cursor', 'keypoints.json');

/** 抖动用的种子（固定值；换它 = 换一条"手抖"的纹理）。 */
export const CURSOR_SEED = 20261002;

/**
 * 抖动窗口的帧长。契约是"每 6–10 帧换一个偏移目标"，取 8。
 * ⚠️ 逐帧独立随机**不行**：那看起来是静电，不是手（§三 的原话）。
 */
export const JITTER_STEP = 8;

/** 抖动的幅度区间（px，1920×1080 上）。契约是 1–3 px。 */
export const JITTER_MIN = 1;
export const JITTER_MAX = 3;

/**
 * 「一次轻微过冲」的幅度（相对 A→B 的距离）。
 * 0.08 = 最多冲过目标 8% 再回落；`overshootShape` 的峰值归一化到 1，所以实际过冲 ≈ 2%。
 * 鼠标高速移动时确实会冲过一点点 —— 这是"不是匀速直线"的一部分（§三）。
 */
export const OVERSHOOT = 0.08;

/**
 * @typedef {Object} Keypoint
 * @property {number} n 帧号（由 `frameAt(t)` 算出来，**不写在清单里**）
 * @property {number} t 秒
 * @property {string} at 锚点名（`layout.js` 的 `ANCHORS`）
 * @property {number} x 帧坐标（由锚点解出来）
 * @property {number} y
 * @property {string} [note]
 */

/**
 * 读关键点清单并解成帧坐标。**import 时执行一次**（它是配置，不是跨帧状态）。
 *
 * 三处会**当场抛错**（宁可开机就红，也不要渲出一版鼠标乱跑的片子）：
 * 文件不存在 / 结构不对 / `at` 不是 `ANCHORS` 里的名字 / `t` 不是递增。
 * @returns {{keypoints: Keypoint[], source: string}}
 */
function loadKeypoints() {
  /** @type {any} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(KEYPOINTS_FILE, 'utf8'));
  } catch (e) {
    throw new Error(
      `读不到鼠标关键点清单 ${KEYPOINTS_FILE}\n` +
        `  ${/** @type {Error} */ (e).message}\n` +
        `  hint: 那份清单是**唯一**的路径来源（画面规格 §三 的路径契约），不要绕过它`,
    );
  }
  if (!raw || !Array.isArray(raw.keypoints) || raw.keypoints.length === 0) {
    throw new Error(`${KEYPOINTS_FILE}: 缺 keypoints 数组（或它是空的）`);
  }
  const names = Object.keys(ANCHORS);
  /** @type {Keypoint[]} */
  const out = [];
  for (const [i, k] of raw.keypoints.entries()) {
    if (typeof k?.t !== 'number' || typeof k?.at !== 'string') {
      throw new Error(`${KEYPOINTS_FILE}: 第 ${i} 个关键点缺 t（秒）或 at（锚点名）`);
    }
    const a = /** @type {Record<string, {x: number, y: number}>} */ (ANCHORS)[k.at];
    if (!a) {
      throw new Error(
        `${KEYPOINTS_FILE}: 第 ${i} 个关键点的 at="${k.at}" 不在 ANCHORS 里\n` +
          `  hint: 可用锚点：${names.join(' / ')}（锚点在 film/engine/layout.js）`,
      );
    }
    const n = frameAt(k.t);
    if (out.length && n <= out[out.length - 1].n) {
      throw new Error(
        `${KEYPOINTS_FILE}: 关键点的帧号必须**严格递增**（第 ${i} 个是 ${n}，前一个是 ${out[out.length - 1].n}）\n` +
          `  hint: 相邻两个关键点至少差 1 帧，否则"从 A 到 B"的时长是 0`,
      );
    }
    out.push({ n, t: k.t, at: k.at, x: a.x, y: a.y, note: k.note });
  }
  return { keypoints: out, source: KEYPOINTS_FILE };
}

const LOADED = loadKeypoints();

/** 关键点（帧坐标已解出来；**只读**，别改它）。 */
export const KEYPOINTS = LOADED.keypoints;

/** 她第一次出现的帧（= 第一个关键点的帧）。之前没有鼠标。 */
export const CURSOR_FIRST_FRAME = KEYPOINTS[0].n;

/**
 * 三次缓动的 ease-in-out（`4u³` / `1-(-2u+2)³/2`）。
 * @param {number} u 0..1
 * @returns {number} 0..1
 */
export function easeInOutCubic(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * 过冲的形状函数：在 `u = 0.75` 处取 1、两端为 0、在途中恒为正（`9.4815 = 1/(0.75³·0.25)`）。
 * 乘上 {@link OVERSHOOT} 之后加在缓动进度上 ⇒ 进度**冲过 1 再回到 1**（一次轻微过冲）。
 * @param {number} u 0..1
 * @returns {number} 0..1
 */
export function overshootShape(u) {
  return 9.4815 * u * u * u * (1 - u);
}

/**
 * 关键点之间那一小段的**基准位置**（不含抖动）。
 * `n` 落在 `[kp[i].n, kp[i+1].n]` 内；恰好等于某个关键点的帧时返回**正好那个锚点**
 * （"落点与时刻正确"就是这条）。
 * @param {number} n
 * @returns {?{x: number, y: number, from: Keypoint, to: Keypoint, u: number}}
 */
export function pathAt(n) {
  if (n < CURSOR_FIRST_FRAME) return null;
  const kps = KEYPOINTS;
  let i = 0;
  while (i < kps.length - 1 && n >= kps[i + 1].n) i++;
  const a = kps[i];
  const b = kps[i + 1];
  if (!b) return { x: a.x, y: a.y, from: a, to: a, u: 1 };
  const span = b.n - a.n;
  const u = (n - a.n) / span;
  const s = easeInOutCubic(u) + OVERSHOOT * overshootShape(u);
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, from: a, to: b, u };
}

/**
 * 第 `k` 个抖动窗口的偏移（px）—— **不是**按帧独立随机，是按窗口播种。
 * @param {number} k 窗口号
 * @returns {{x: number, y: number}}
 */
function jitterOffset(k) {
  const g = frameRng(CURSOR_SEED, k);
  const ang = g() * Math.PI * 2;
  const r = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * g();
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/**
 * 第 `n` 帧的低频抖动偏移：相邻窗口之间用 smoothstep 插值
 * （两端导数为 0 ⇒ 没有折角，看起来是"手在飘"而不是"逐帧静电"）。
 * @param {number} n
 * @returns {{x: number, y: number}}
 */
export function jitterAt(n) {
  const k = Math.floor(n / JITTER_STEP);
  const u = (n - k * JITTER_STEP) / JITTER_STEP;
  const w = u * u * (3 - 2 * u);
  const a = jitterOffset(k);
  const b = jitterOffset(k + 1);
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

/**
 * @typedef {Object} CursorState
 * @property {boolean} visible 这一帧她在不在画面上（引子 0–419 不在）
 * @property {number} x 帧坐标（px，含抖动；左上原点）
 * @property {number} y
 * @property {'ibeam'|'hand'|'arrow'} shape 形状（由落点推断，§三）
 * @property {?Keypoint} from 这一段从哪个关键点出发（`visible=false` 时是 null）
 * @property {?Keypoint} to
 * @property {number} u 段内进度 0..1
 * @property {{x: number, y: number}} jitter 这一帧的抖动偏移（诊断用）
 */

/**
 * 第 `n` 帧的鼠标状态。**这是唯一入口**（绘制、探针、测试都走它）。
 * @param {number} n 帧号
 * @returns {CursorState}
 */
export function cursorAt(n) {
  const p = pathAt(n);
  if (!p) {
    return { visible: false, x: 0, y: 0, shape: 'arrow', from: null, to: null, u: 0, jitter: { x: 0, y: 0 } };
  }
  const j = jitterAt(n);
  // 夹在画面内 1px（抖动幅度只有 1–3px，但夹一下就不用担心关键点本身贴边）
  const x = Math.min(W - 2, Math.max(1, p.x + j.x));
  const y = Math.min(H - 2, Math.max(1, p.y + j.y));
  return {
    visible: true,
    x,
    y,
    shape: cursorShapeAt(x, y),
    from: p.from,
    to: p.to,
    u: p.u,
    jitter: j,
  };
}

/**
 * 她在**某一段帧区间**里到过的全部形状（测试与报告用）。
 * @param {number} n0 @param {number} n1 半开 `[n0, n1)`
 * @returns {Set<string>}
 */
export function shapesIn(n0, n1) {
  /** @type {Set<string>} */
  const s = new Set();
  for (let n = n0; n < n1; n++) {
    const c = cursorAt(n);
    if (c.visible) s.add(c.shape);
  }
  return s;
}

/**
 * 自述（报告 / 探针用）。
 * @returns {string}
 */
export function describe() {
  const kps = KEYPOINTS.map(
    (k) => `  帧 ${String(k.n).padStart(4)}  t=${k.t.toFixed(3)}s  ${k.at.padEnd(15)} (${Math.round(k.x)}, ${Math.round(k.y)})  ${k.note ?? ''}`,
  );
  return [
    `她 = 一只鼠标箭头（全片唯一）· 关键点 ${KEYPOINTS.length} 个 · 来源 ${KEYPOINTS_FILE.split(/[\\/]/).slice(-2).join('/')}`,
    `  首次出现 帧 ${CURSOR_FIRST_FRAME}（${(CURSOR_FIRST_FRAME / FPS).toFixed(3)}s）· 抖动每 ${JITTER_STEP} 帧换目标、幅度 ${JITTER_MIN}–${JITTER_MAX}px · 过冲 ${OVERSHOOT}`,
    ...kps,
  ].join('\n');
}
