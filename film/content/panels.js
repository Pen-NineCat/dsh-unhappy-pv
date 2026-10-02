/**
 * film/content/panels.js — **T4：三格版面的骨架**（画面规格 §1.2 T4 / §2.2）。
 *
 * ## T4 只要什么
 *
 * 画面规格原文：
 * > **T4 先把三格版面搭出来**（含 §2.2 的几何），**两格 canvas 侧先放空面板**。
 * > **T4 的"空面板"标准**：两格各有**边界**、**底色**、**标题行**（右上 `Terminal`、右下 `Memory`），
 * > **内容为空**。目的：**版面一旦跑出来就能立刻判断"格子对不对"，不用等内容。**
 *
 * ⚠️ §1.2 原文标题是小写（`terminal`/`memory`），**按作者 2026-10-01 的 A8 改成首字母大写**
 * （`CELL_TITLE` 一处，含右上那格换成网络结构时用的 `Network`）。
 *
 * 所以这里**只画**：右列底色、两条分隔线（竖的在左格右缘、横的在右列中间）、
 * 两个面板的边界与标题行。**不画**任何内容（终端日志、memory 行、层堆叠都不在这里）。
 *
 * ## 为什么右列是"露出来"的而不是"淡入"的
 *
 * 引子的拉远是 ⭐**窗口真的在变小**（§2.1 U3）：左格宽从 1920 收到 1152，页面自己重排。
 * 图形层这边**不需要做任何过渡** —— 右列一直在那儿，只是帧 350 之前左格盖满了整幅，
 * 它被挡在外面。于是"格子线在缩小的过程中才出现"是**自然的**，不是补一个动画出来的。
 * （`leftWidthAt(n)` 在 n ≤ 350 时返回 1920，右列宽 0，什么都画不出来。）
 *
 * ## 颜色是从 dsh 自己的深色令牌抄来的（不是我们编的）
 *
 * 「层长什么样」是画面规格 §1.4 的 ⛔#4（**未定**），所以这一版**不做任何风格设计**：
 * 底色/边框/文字色取 dsh 深色主题里实测到的那几个值（`--dsw-alias-*` 的解析结果），
 * 好让三格与左格里的真 dsh UI 看起来是同一套布。等层的长相定了再谈好看。
 *
 * 纪律（`AGENTS.md` §2 规则 12）：只调 `film/kit/` 与 `film/engine/` 的接口；
 * 文字一律走**字形图集**（`kit/text.js`），碰 `ctx.font` 会把中文渲成豆腐块（`content/example.js` 踩过）。
 */

import { H, W } from '../engine/clock.js';
import { CELL_TITLE, HALF_H, RIGHT_W, leftWidthAt } from '../engine/layout.js';
import { ctx2d } from '../kit/canvas.js';
import { cellMetrics, drawText, glyphAtlas, registerFont, resolveFontFile } from '../kit/text.js';

/**
 * T4 的占位配色。**来源**：dsh 深色主题的实测解析值（见 `film/vendor/dsh-css/tokens.json`：
 * `--dsw-alias-bg-base` = `#151517`、`--dsw-alias-markdown-code-block` = `#1b1b1c`、
 * `--dsw-alias-border-l1` = `#ffffff0f`、`--dsw-alias-label-secondary` = `#cfd3d6`、
 * `--dsw-alias-label-caption` = `#8b8f94`）。
 * ⚠️ 这不是"设计"，是"先别自己发明一套色"。
 */
export const PANEL_COLORS = {
  bg: '#151517',
  panel: '#1b1b1c',
  border: 'rgba(255,255,255,0.06)',
  title: '#cfd3d6',
  caption: '#8b8f94',
};

/** 标题行的字号与行高（px）。 */
const TITLE_SIZE = 18;
const TITLE_ROW = 40;

/** 标题图集（只依赖字符集与字号，**与 n 无关**，所以缓存它不会破坏纯函数）。 */
let atlas = null;

/**
 * 标题用到的字符（预先枚举，图集只烤一次）。
 * ⚠️ 导出它是为了让测试能核对「`CELL_TITLE` 里的每个字符都在图集字符集里」——
 * 少了字符不会报错，只会在画布上静默少一笔（`terminal` 那次差点漏掉）。
 */
export const TITLE_CHARS = 'TerminalMemoryNetworkmoy0123456789 /·—';

/** @returns {{font: any, metrics: any}} */
function titleAtlas() {
  if (atlas) return atlas;
  const monoPath = resolveFontFile(['consola.ttf', 'Consolas.ttf']);
  const font = glyphAtlas(registerFont(monoPath, TITLE_SIZE, 't4-mono'), TITLE_CHARS);
  atlas = { font, metrics: cellMetrics(font) };
  return atlas;
}

/**
 * 画一个空面板：底色 + 边界 + 标题行（+ 标题行下的分隔线）。
 * 矩形由调用方给，**必须是整数像素**（几何来自 `engine/layout.js`）。
 * @param {import('../engine/frame.js').FrameState} s
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @param {string} title
 */
function emptyPanel(s, rect, title) {
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0) return;
  const chrome = ctx2d(s.stack.chrome);

  // 底色（比背景略亮一档，看得出"这是一个格子"）
  chrome.fillStyle = PANEL_COLORS.panel;
  chrome.fillRect(x, y, w, h);

  // 标题行：一条分隔线 + 标题文字
  chrome.fillStyle = PANEL_COLORS.border;
  chrome.fillRect(x, y + TITLE_ROW, w, 1);

  const a = titleAtlas();
  const pad = 16;
  drawText(s.stack.chrome, a.font, { x: x + pad, y: y + Math.round((TITLE_ROW + a.metrics.ascent) / 2) }, title, {
    color: PANEL_COLORS.title,
  });
}

/**
 * 画三格版面的骨架（T4）。**内容为空**。
 * @param {import('../engine/frame.js').FrameState} s
 */
export function drawPanels(s) {
  const { n } = s;
  const leftW = leftWidthAt(n);

  // 左格盖满整幅时（引子前半），右列宽 0 —— 什么都不画就是对的
  if (leftW >= W) return;

  const chrome = ctx2d(s.stack.chrome);
  const rightW = W - leftW;

  // 1) 右列底色（左格那块留给网页截图，1:1 贴入）
  chrome.fillStyle = PANEL_COLORS.bg;
  chrome.fillRect(leftW, 0, rightW, H);

  // 2) 两条分隔线：竖线在左格右缘，横线在右列中间。
  //    竖线**一直画**（它就是左格的边），横线只在右列露出来之后才有意义。
  chrome.fillStyle = PANEL_COLORS.border;
  chrome.fillRect(leftW, 0, 1, H);
  if (rightW >= RIGHT_W) chrome.fillRect(leftW, HALF_H, rightW, 1);

  // 3) 两个空面板（标题行 + 底色 + 边界）。上下平分是**暂定**（见 layout.js）。
  //    只在右列**完整**露出来之后才画面板 —— 拉远途中右列还没到位，
  //    先画会在边界上留下半截色块（那看起来像 bug，不像过程）。
  if (rightW >= RIGHT_W) {
    emptyPanel(s, { x: leftW, y: 0, w: rightW, h: HALF_H }, CELL_TITLE.term);
    emptyPanel(s, { x: leftW, y: HALF_H, w: rightW, h: H - HALF_H }, CELL_TITLE.memory);
  }
}
