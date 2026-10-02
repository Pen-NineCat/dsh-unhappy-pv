/**
 * film/pages/caret.js — **文字光标闪不闪**：一个纯 `n` 的方波（画面规格 §三「焦点」那一行）。
 *
 * ## 规格怎么说的
 *
 * > | 焦点 | **不需要独立的焦点表**：谁获得焦点由 §2.2 / §2.3 的逐句表决定
 * >   （**谁在动作，谁就有焦点，文字光标随之闪烁**） |
 *
 * 所以"闪"不是装饰，是**焦点在谁身上**的可视证据。而焦点表**不要** ——
 * 焦点是从"这一帧谁在动作"推出来的。
 *
 * ## 为什么要单独一个模块
 *
 * 1. **两处要用**：`[419, 484)` 她在输入框打字（T5）、幕间 `[2106, 2238)` 她"打了又删"（§2.3）。
 * 2. **逐帧渲染不能靠 CSS 动画**：CSS 动画跟真实时间走，是逐帧渲染的毒药
 *    （§2.1 对滚动也是同一条理由）。所以闪在这里是 `Math.floor((n - phaseFrom) / 12) % 2`，
 *    纯函数、可断言、与焊点 3 无关。
 *
 * ## 三条规则（都是真实光标的脾气）
 *
 * 1. **周期 12 + 12 帧**（= 0.5 s 亮 / 0.5 s 灭）：Windows 默认闪烁频率约 530 ms，24 fps 下最接近的整数是 12。
 * 2. **刚获得焦点的那一帧是亮的**（`phaseFrom` 对齐），不是先灭半秒 —— 真光标就是点下去立刻出现。
 * 3. ⭐ **正在动作的那一帧一定是亮的**：真人打字时**光标不闪**（每次按键都会重置闪烁计时器），
 *    松手之后才开始闪。这一条是"看起来像真的"与"看起来像节拍器"的分界。
 */

/** 一拍多少帧（亮 12 / 灭 12；24 fps 下 0.5 s）。 */
export const BLINK_HALF_FRAMES = 12;

/**
 * 第 `n` 帧光标亮不亮。
 * @param {number} n 帧号
 * @param {{phaseFrom: number, active?: boolean}} o
 *   `phaseFrom` = 获得焦点的那一帧（它自己一定是亮的）；
 *   `active` = 这一帧**她/他正在动作**（有字符增减）→ 强制亮。
 * @returns {boolean}
 */
export function caretOn(n, o) {
  if (n < o.phaseFrom) return false;
  if (o.active) return true;
  const k = n - o.phaseFrom;
  return Math.floor(k / BLINK_HALF_FRAMES) % 2 === 0;
}

/**
 * 一个帧区间里光标亮/灭的帧数（测试与报告用）。
 * @param {number} n0 @param {number} n1 半开 `[n0, n1)`
 * @param {{phaseFrom: number, activeAt?: (n: number) => boolean}} o
 * @returns {{on: number, off: number, flips: number}}
 */
export function caretStats(n0, n1, o) {
  let on = 0;
  let off = 0;
  let flips = 0;
  let prev = null;
  for (let n = n0; n < n1; n++) {
    const v = caretOn(n, { phaseFrom: o.phaseFrom, active: o.activeAt ? o.activeAt(n) : false });
    if (v) on++;
    else off++;
    if (prev !== null && v !== prev) flips++;
    prev = v;
  }
  return { on, off, flips };
}
