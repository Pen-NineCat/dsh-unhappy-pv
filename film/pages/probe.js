/**
 * film/pages/probe.js — **截图管线探针页**（Phase 5 的回归夹具，不再是默认页面）。
 *
 * 它画的**不是 dsh 的界面**，而是一个刻意构造的最小页面，用来把七个焊点里的
 * 三个钉成可验证的断言（见附录 C 记录 11）：
 *
 * | 焊点 | 探针提供的靶子 | 谁验它 |
 * |---|---|---|
 * | 3（`pause()` + `currentTime`） | `#spin` 上那条 `@keyframes probe-spin`，角度 = `n % 360` | `shot.mjs --jitter-check` |
 * | 5（首帧多等） | 页面本身没有任何异步 | `shot.mjs --smoke` |
 * | 7（资源全本地） | `./assets/probe-dot.svg` | `shot.mjs` 的请求记录 |
 *
 * ## 为什么它还留着（而不是删掉）
 *
 * R1 的引子页面上只有**一条** CSS 动画（思维链的扫描），而且它在伪元素 `::after` 上，
 * 读不出角度、也做不了「角度必须随 n 变」这条量化断言。
 * 探针的方块是**能被读出角度**的靶子 —— 删了它，「焊点 3 到底有没有用」就只剩
 * 一个「两次截图一样」的弱证据（而不一样才需要解释）。
 *
 * 用法：`node film/pages/shot.mjs --variant probe --jitter-check`
 */

import { DARK, LIGHT } from './theme-probe.js';

/**
 * 每帧的滚动位置（探针版）：一条**确定的线性推进**，只为让「滚动区真的在滚」可验证。
 *
 * ⚠️ 循环长度必须 ≥ 内容的**可滚动范围**（内容高 − 视口高），否则 `scrollTop` 会一直在
 * 可滚动范围的顶端几像素里打转，看起来像「没滚」。实测教训：
 * 24 行（≈432 px）在 640 px 的视口里**根本装不满**，`scrollTop` 永远是 0。
 * 所以行数要足够多（见 `ROWS`），并且这里按每帧 3 px 推进。
 * @param {number} n 帧号
 * @returns {number} 滚动位置（CSS px）
 */
export function probeScroll(n) {
  const perFrame = 3; // 3 px/帧 ≈ 72 px/s
  const span = 3600; // 循环长度（px）：远超任何合理的可滚动范围
  return (n * perFrame) % span;
}

/**
 * 探针页的行数。
 *
 * 必须让「内容高 >>> 视口高」，否则滚动区不滚（见 `probeScroll` 的实测教训）。
 * 90 行 × 约 30 px（18 px 行高 + 10 px 内边距 + 1 px 边线）≈ 2700 px，
 * 在 640 px 视口下可滚动约 2060 px —— 足够观察。
 */
const ROWS = 90;

/**
 * @typedef {Object} ProbeOptions
 * @property {number} [width] 视口宽（CSS px）
 * @property {number} [height] 视口高
 * @property {'dark'|'light'} [theme]
 * @property {?number} [scrollPx] 覆盖每帧算出来的滚动位置（测试用）
 */

/**
 * 探针页的一帧正文。
 * @param {number} n 帧号
 * @param {ProbeOptions} [opts]
 * @returns {string} HTML
 */
export function probeBody(n, opts = {}) {
  const width = opts.width ?? 960;
  const height = opts.height ?? 640;
  const th = opts.theme === 'light' ? LIGHT : DARK;
  const scroll = opts.scrollPx ?? probeScroll(n);

  // 第 3 个焊点用的旋转动画：角度必须是 (n) 的纯函数，且**测试要能读出角度**
  const angle = (n % 360) * 1;

  return `
<div class="probe" style="--probe-w:${width}px;--probe-h:${height}px;background:${th.bg};color:${th.fg}">
  <header class="probe__fixed" style="border-bottom:1px solid ${th.border};background:${th.bgRaised}">
    <div class="probe__title">screenshot pipeline probe</div>
    <div class="probe__meta" style="color:${th.fgMuted}">n=${n} · t=${(n / 24).toFixed(4)}s · 这一段是固定区（不随滚动变化）</div>
    <div class="probe__row">
      <span class="probe__label">spin</span>
      <span class="probe__spin" id="spin" style="--angle:${angle}deg;border-color:${th.accent}"></span>
      <span class="probe__angle" id="angle" style="color:${th.fgMuted}">${angle}deg</span>
    </div>
    <div class="probe__row">
      <span class="probe__label">img.decode()</span>
      <img id="localimg" class="probe__img" src="./assets/probe-dot.svg" width="24" height="24" alt="" />
    </div>
  </header>
  <main class="probe__scroll" id="scroll" data-scroll="${scroll}">
    ${Array.from({ length: ROWS }, (_, i) => probeRow(i, th, n)).join('\n    ')}
  </main>
</div>`.trim();
}

/**
 * 一行的内容。行数固定、内容只依赖 `(i, n)`，所以整页仍是 `n` 的纯函数。
 * @param {number} i @param {typeof DARK} th @param {number} n
 * @returns {string}
 */
function probeRow(i, th, n) {
  const line = `第 ${String(i + 1).padStart(2, '0')} 行 · 滚动区内容 · frame ${n}`;
  const ascii = `line ${String(i + 1).padStart(2, '0')}  ................  ${(i * 7 + n) % 1000}`;
  return `<div class="probe__line" style="border-bottom:1px solid ${th.border}">
      <span class="probe__cjk">${line}</span>
      <span class="probe__ascii" style="color:${th.fgMuted};font-family:${th.mono}">${ascii}</span>
    </div>`;
}

/**
 * 探针页的 CSS。由 `body.js` 的 `pageCss()` 拼进去（两种变体共用一份 `stage.html`，
 * 这样 `--jitter-check` / `--scroll-check` 不必重新生成页面）。
 * @returns {string}
 */
export function probeCss() {
  return `
/* ── probe 变体（回归夹具，不是成片画面）────────────────────────────── */
.probe { display: flex; flex-direction: column; width: var(--probe-w); height: var(--probe-h); overflow: hidden; }
.probe__fixed { flex: 0 0 auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
.probe__title { font-size: 15px; font-weight: 600; letter-spacing: .2px; }
.probe__meta { font-size: 12px; }
.probe__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.probe__label { min-width: 96px; opacity: .8; }
.probe__spin { width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 3px; display: inline-block; transform: rotate(var(--angle)); animation: probe-spin 4s linear infinite; }
@keyframes probe-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.probe__img { width: 24px; height: 24px; display: block; }
.probe__scroll { flex: 1 1 auto; overflow: hidden; }
.probe__line { display: flex; justify-content: space-between; gap: 12px; padding: 5px 18px; font-size: 12px; line-height: 18px; }
.probe__ascii { white-space: pre; }`.trim();
}
