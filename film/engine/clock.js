/**
 * film/engine/clock.js — 时间与画布常量的**唯一来源**。
 *
 * `AGENTS.md` §2 规则 5：帧号是唯一主键，`n = Math.round(t * FPS)`。
 * `AGENTS.md` §5：全仓搜 `24` / `1920` / `1080` 时只应在本文件与测试里命中。
 *
 * 所以：**别处不许再写这些数字**，一律从这里 import。
 * 唯一允许的例外是 `film/check.js` 里那条「与 `Resource/song.json` 对齐」的断言 ——
 * 它必须把两边的数拿来比，否则漂移没人发现。
 *
 * 已锁值（2026-10-01，`AGENTS.md` §1 / `Resource/song.json`）：
 *   FPS = 24，W = 1920，H = 1080，END_T = 4741/24 = 197.54166666666666 s
 * 🔊 **改 FPS 会让母版失效**（`AGENTS.md` §2 规则 10）：母版的数值依赖 fps，
 *    必须重跑 `tools/trim-song.mjs make` 并更新 `Resource/song.json` 的两个 sha256。
 *
 * @typedef {{fps: number, width: number, height: number, startT: number, endT: number,
 *            frameCount: number}} FilmSpec
 */

/**
 * 帧率。锁 24（2026-10-01）。
 * 刻意**不做环境变量覆盖** —— 改帧率必须重新生成母版，不能是一条命令的副作用。
 * @type {number}
 */
export const FPS = 24;

/** 原生画布宽（`AGENTS.md` §1：1920×1080 原生，不做 720p 放大）。 @type {number} */
export const W = 1920;

/** 原生画布高。 @type {number} */
export const H = 1080;

/** 片子起点（秒）。时间零点 = 母版的第一个解码采样（`AGENTS.md` §3）。 @type {number} */
export const START_T = 0;

/**
 * 片子终点（秒）= 4741 / 24。由**整数帧数**反推，不写 197.568（那是原曲长度，
 * 尾部那 0.632 帧已被母版剪掉）。
 * @type {number}
 */
export const END_T = 4741 / 24;

/** 期望总帧数 = `Math.round(END_T * FPS)` = 4741。 @type {number} */
export const FRAME_COUNT = Math.round(END_T * FPS);

/** 整片时长（秒）。 @type {number} */
export const DURATION = END_T - START_T;

/** 一秒里的帧数，缓存一下省得到处写 `1 / FPS`。 @type {number} */
export const SEC_PER_FRAME = 1 / FPS;

/**
 * 绝对时间（秒）→ 帧号。**唯一主键**，`AGENTS.md` §2 规则 5。
 * @param {number} t 绝对时间，秒（允许落在 [START_T, END_T] 之外）
 * @returns {number} 帧号，整数
 */
export function frameAt(t) {
  return Math.round(t * FPS);
}

/**
 * 帧号 → 该帧的绝对时间（秒）。`frame(n)` 里所有「时间」都该由它得到，
 * 不要拿 `n / FPS` 到处写 —— 那两个在浮点上等价，但只有一个来源。
 * @param {number} n 帧号
 * @returns {number} 秒
 */
export function timeAt(n) {
  return n / FPS;
}

/**
 * 帧号 → 该帧覆盖的时间区间 `[t0, t1)`，秒。
 * 时间线断言与 `reveal` 类转场都要用它。
 * @param {number} n
 * @returns {[number, number]}
 */
export function spanAt(n) {
  const t0 = n / FPS;
  return [t0, (n + 1) / FPS];
}

/**
 * 一帧的时长（秒）。
 * @param {number} [_n] 帧号（保留参数，将来若支持变帧率不用改调用点）
 * @returns {number}
 */
export function frameDuration(_n) {
  return SEC_PER_FRAME;
}

/**
 * 帧号是否在片内（`0 <= n < FRAME_COUNT`）。
 * @param {number} n
 * @returns {boolean}
 */
export function isFrameInRange(n) {
  return Number.isInteger(n) && n >= 0 && n < FRAME_COUNT;
}

/**
 * 帧数 → 秒（总时长，不含零头）。
 * @param {number} frames
 * @returns {number}
 */
export function framesToSeconds(frames) {
  return frames / FPS;
}

/**
 * 把当前常量打成一个对象，给 `film/check.js` 与日志用。
 * @returns {FilmSpec}
 */
export function spec() {
  return {
    fps: FPS,
    width: W,
    height: H,
    startT: START_T,
    endT: END_T,
    frameCount: FRAME_COUNT,
  };
}

/**
 * 人类可读的一行摘要。
 * @returns {string}
 */
export function describe() {
  return `${W}×${H} @ ${FPS} fps · t ∈ [${START_T}, ${END_T}] s · ${FRAME_COUNT} 帧`;
}
