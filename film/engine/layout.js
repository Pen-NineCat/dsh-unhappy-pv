/**
 * film/engine/layout.js — **版面几何的唯一来源**（画面规格 §2.1 U3 / §2.2）。
 *
 * 为什么放在 `engine/` 而不是 `content/` 或 `pages/`：**两个渲染器要的是同一个数**——
 * 网页层要按左格宽度设 viewport（"窗口真的在变小"），图形层要把右列画在它右边。
 * 两边各写一份，迟早会漂一像素，而"1:1 贴入"在差一像素时是看不出来的（只会有点糊）。
 *
 * ## 现行结论（画面规格 `design-options.md` 2026-10-01 版）
 *
 * ```
 * 左：dsh web ui（全高）1152×1080   |   右上：terminal 或 network 768×540
 *                                  |   右下：memory              768×540
 * ```
 *
 * - **几何**（§2.2「几何（已定 ①）」）：60% / 40%，上下**先平分**；
 *   ⚠️ 上下平分是**暂时的** —— memory 会越长越多、terminal 最多 5 行，方向是"下面那格更大"，
 *   等看到图再调。要改就改这一处。
 * - **谁画哪一格**（§2.2，⚠️**暂定 A**）：只有左格走浏览器（真 dsh UI 截图），
 *   右上与右下全部图形侧。T4 的"两格先放空面板"本身就预设了 A。
 * - **引子的拉远**（§2.1 U3）：引子开始是**满屏 UI**，帧 350–418 缩到左格；
 *   而且 ⭐**"缩"不是缩放位图，是窗口真的在变小** —— 每帧按当前矩形设 viewport，让页面自己重排。
 *   ⇒ 左格宽度是 `n` 的函数：`leftWidthAt(n)`，**满屏那一版必须渲成 1920×1080**（不是 1920×1280）。
 */

import { H, W } from './clock.js';

/** 第一幕左格宽（px）。★ 改比例只改这一处。 */
export const LEFT_W = 1152;

/** 右列宽（px）。 */
export const RIGHT_W = W - LEFT_W;

/** 右列上下平分时每格的高（px）。★ 暂定，见文件头。 */
export const HALF_H = Math.round(H / 2);

/**
 * 三格矩形，**整数像素**（§2.2）。
 * 名字用 `term` / `memory` 对应右上 / 右下两个面板的标题。
 */
export const CELLS = {
  /** 左格：浏览器截图的**目标矩形**（1:1 贴入） */
  left: { x: 0, y: 0, w: LEFT_W, h: H },
  /** 右列整体 */
  right: { x: LEFT_W, y: 0, w: RIGHT_W, h: H },
  /** 右上：terminal 或 network 结构（二者互斥，同占一格） */
  term: { x: LEFT_W, y: 0, w: RIGHT_W, h: HALF_H },
  /** 右下：memory */
  memory: { x: LEFT_W, y: HALF_H, w: RIGHT_W, h: H - HALF_H },
};

/**
 * 两个面板的标题。
 *
 * ⚠️ **首字母大写**（作者 2026-10-01 定，A8）：`Terminal` / `Memory` / `Network`。
 * 画面规格 §1.2 T4 那一行写的是小写（`terminal`/`memory`），以这里为准 ——
 * 真实 dsh 的界面里标题就是首字母大写（`Terminal`），小写是我当时按 §1.2 抄的。
 *
 * `term` 与 `network` 是**右上同一格的两种内容**（§2.2：「terminal 或 network 结构，二者互斥，同占一格」）：
 * - 第一幕 `[419, 1903)` 里右上一直是 `Terminal`（V2 的四条日志在 T8）；
 * - 到 T6 起那一格换成网络层堆叠 → 标题也跟着换成 `Network`（`panels.js` 的 `emptyPanel` 已经收标题参数，
 *   切换只是传哪个常量的事）。
 */
export const CELL_TITLE = { term: 'Terminal', memory: 'Memory', network: 'Network' };

/**
 * 面板内部的度量（**右列两格共用**，所以放这里而不是各写一份）。
 *
 * `titleRow` 是标题行的高（标题行下沿那条分隔线就画在 `y + titleRow`）；
 * `pad` 是内容距面板左缘的内边距；`size` 是标题字号。
 * ⚠️ 这三个值是 T4 画出来之后**人眼看过**的（记录 28），改它们等于改版面的观感，
 * 不是"随手调一个常数"。
 */
export const PANEL = { titleRow: 40, pad: 16, titleSize: 18 };

/**
 * **控件矩形表**（帧坐标系，1920×1080，左上原点）—— 鼠标的形状与落点都靠它。
 *
 * 画面规格 §三 的路径契约：
 * > **形状不采**：由 `(x,y)` 落在哪个控件推断 —— **输入框矩形内 = I-beam；可点控件上 = 手型；其余 = 箭头**
 * > （**判据就是 §2.2 的几何**）
 *
 * ⚠️ **这一张表是量出来的，不是算出来的**：值来自 `film/test/probe-cursor.mjs`
 * （把 `body.js` 在左格 1152×1080 下打开，读 `getBoundingClientRect()`），
 * 那个探针会**零容差**地比对这张表 —— 改了页面的 CSS 而没改这里，它会红。
 * 理由：输入框那一列的宽度由 dsh 自己的 CSS 与 `.dsh-col` 的 clamp 共同决定，
 * 手算一遍迟早差几个像素，而"箭头压在输入框边上"这种错肉眼判不出来。
 *
 * `kind`：`text` = 落在里面是 **I-beam**；`button` = 落在里面是**手型**。
 * @type {Readonly<Record<string, {x: number, y: number, w: number, h: number, kind: 'text'|'button', note: string}>>}
 */
export const CONTROLS = {
  // 输入框的文字区（`.uV2eYG_input`）—— 落在里面是 I-beam（`text`）
  'composer.input': { x: 231, y: 982, w: 685, h: 36, kind: 'text', note: '输入框文字区（I-beam）' },
  // 输入框左下那个「+」（`.uV2eYG_add`，28×28 圆钮）
  'composer.add': { x: 239, y: 1035, w: 28, h: 28, kind: 'button', note: '附件按钮（手型）' },
  // 输入框右下那个发送箭头（`.uV2eYG_primary`，34×34 圆钮）
  'composer.send': { x: 879, y: 1030, w: 34, h: 34, kind: 'button', note: '发送按钮（手型）' },
};

/**
 * **锚点表**：路径契约里"从 A 到 B"的那些 A / B —— 一个控件上的**落点**。
 *
 * 名字进 `data/cursor/keypoints.json`（那份清单是作者可改的），坐标在代码里
 * （因为它必须落在 {@link CONTROLS} 的某个矩形内，改控件就得跟着改）。
 *
 * 两个锚点的出处：
 * - `composer.input` = 输入框文字区的**正中**；`00:17.454–00:20.114` 她就在这里打字
 *   （§2.2：输入框里逐字出现又删掉）。
 * - `left.watch` = **输入框正上方 60px**，仍在左格的对话区里（§三：`00:20.114`
 *   「她把字删掉、**箭头移出输入框**（她不再说，开始看）」）。
 *   ⚠️ 文档只规定"移出输入框"，**没说移到哪** —— 我取"就在输入口外面"：
 *   ① 它同时满足 O1 的「她不是闲着，是被**关在输入口外面**」；
 *   ② 新的字都从对话区底部出现，那就是"看"的位置。
 *   要换落点只改这一行（`film/test/cursor.test.js` 会检查它落在哪个控件上）。
 * @type {Readonly<Record<string, {x: number, y: number, note: string}>>}
 */
export const ANCHORS = {
  'composer.input': { x: 573, y: 1000, note: '输入框文字区正中（I-beam）' },
  'left.watch': { x: 573, y: 914, note: '输入框上方 60px 的对话区（箭头）' },
};

/**
 * `(x,y)` 上是什么控件 —— 鼠标**形状**的唯一判据（§三 的路径契约）。
 *
 * 多个控件重叠时取**先登记**的那个（`CONTROLS` 的插入顺序），所以把小的、具体的放前面。
 * @param {number} x 帧坐标（px）
 * @param {number} y
 * @returns {'ibeam'|'hand'|'arrow'}
 */
export function cursorShapeAt(x, y) {
  for (const c of Object.values(CONTROLS)) {
    if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) {
      return c.kind === 'text' ? 'ibeam' : 'hand';
    }
  }
  return 'arrow';
}

/**
 * 引子末尾的**拉远窗口**（帧，**半开** `[start, end)`；`AGENTS.md` §2 规则 13）。
 *
 * 端点被钉死：`n = start` 时还是满屏，`n = end - 1` 时已经是左格宽，
 * 而 `n >= end` 恒为左格宽（帧 419 开词时版面已经是三格 —— §2.1）。
 */
export const PULL = { start: 350, end: 419 };

/**
 * 第 `n` 帧左格的宽度（px）—— **网页层的 viewport 宽、图形层右列的起点，都是它**。
 *
 * 线性推进（"一边写完回复、一边拉远"）。要换成缓动只改这一处；
 * 端点仍然必须钉死，否则帧 419 的版面就不是三格。
 * @param {number} n 帧号
 * @returns {number} px
 */
export function leftWidthAt(n) {
  if (n <= PULL.start) return W;
  if (n >= PULL.end) return LEFT_W;
  // 端点钉死：n = start 出满屏，n = end − 1 正好到位
  const k = (n - PULL.start) / (PULL.end - 1 - PULL.start);
  return Math.round(W + (LEFT_W - W) * k);
}

/**
 * 第 `n` 帧左格的目标矩形（1:1 贴入用）。
 * @param {number} n
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function leftCellAt(n) {
  return { x: 0, y: 0, w: leftWidthAt(n), h: H };
}

/**
 * 第 `n` 帧的右列矩形（宽度随左格变，起点就是左格右边缘）。
 * @param {number} n
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function rightColumnAt(n) {
  const x = leftWidthAt(n);
  return { x, y: 0, w: W - x, h: H };
}

/**
 * 这一帧的三格版面**是否已经成形**（左格到位 = 拉远结束）。
 * 图形层用它决定"格子线画不画"；网页层不用管（它只管自己的 viewport）。
 * @param {number} n
 */
export function isThreeCell(n) {
  return leftWidthAt(n) === LEFT_W;
}
