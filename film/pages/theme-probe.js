/**
 * film/pages/theme-probe.js — **临时占位**：截图探针页自己的一组颜色常量。
 *
 * ⚠️ 这不是设计决定，是**为了让 Phase 5 的管线能被验证**而存在的最小颜色集。
 *
 * 为什么需要它（2026-10-01 实测，见施工说明附录 C 记录 11）：
 * `film/vendor/dsh-web-frontend/` 里那两份 CSS **只有 2 个** `--dsw-*` 变量定义
 * （`--dsw-elevation-stroke-color`、`--dsw-hovercard-bg`），
 * 所有 `--dsw-alias-*` / `--dsw-static-*` 设计令牌的**真定义在主题插件里**
 * （`@deepseek-ai/dsh-client-ui-theme/lib/client.js`，运行时注入）。
 * 所以只 vendor 那 14 个文件**拿不到色板**，`var(--dsw-alias-bg-base, Canvas)` 会落到
 * CSS 系统色（浅色）—— 这正是 T1 探针截图是白底的原因。
 *
 * 用途：`body.js` 的探针变体用它，好让「文字/结构/确定性」这三件事能被验证。
 * **真内容的颜色要以 dsh 设计令牌为准**，那是一件待拍板的事（见报告）。
 *
 * 下面这些值是按 dsh 浅/深两套观感取的近似值。**不要把它们当成 dsh 的真值。**
 */

/**
 * @typedef {Object} ProbeTheme
 * @property {string} bg @property {string} bgRaised @property {string} fg
 * @property {string} fgMuted @property {string} border @property {string} accent
 * @property {string} mono
 */

/** 深色（默认：片子是暗的）。 @type {ProbeTheme} */
export const DARK = Object.freeze({
  bg: '#1b1b1d',
  bgRaised: '#2c2c2e',
  fg: '#f9fafb',
  fgMuted: '#adb2b8',
  border: 'rgb(255 255 255 / 12%)',
  accent: '#4d6bfe',
  mono: 'Consolas, "Liberation Mono", Menlo, Courier, monospace',
});

/** 浅色（只是备着做对比，成片不用）。 @type {ProbeTheme} */
export const LIGHT = Object.freeze({
  bg: '#ffffff',
  bgRaised: '#f5f6f7',
  fg: '#0f1115',
  fgMuted: '#81858c',
  border: 'rgb(0 0 0 / 10%)',
  accent: '#4d6bfe',
  mono: 'Consolas, "Liberation Mono", Menlo, Courier, monospace',
});

/**
 * @param {'dark'|'light'} name
 * @returns {ProbeTheme}
 */
export function theme(name) {
  return name === 'light' ? LIGHT : DARK;
}
