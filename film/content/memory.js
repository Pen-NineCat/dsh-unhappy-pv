/**
 * film/content/memory.js — **右下格 `memory` 里累积的东西**（画面规格 §2.2 / §2.4）。
 *
 * ## 这一格为什么是"会留下来的那一个"
 *
 * §三：**全片唯一会累积、会留下来的东西是记忆**；其余"过期即消失"。
 * §2.4 后面还有「满了就停」（记忆满了就不再提取、不覆盖旧的）与
 * `Export-AgentMemory` / `Import-AgentMemory` / `user_loves_me: false`（那是 T7）。
 *
 * ## T5 的判据：**memory 多两行**
 *
 * §2.2 逐句表两行都写着同一句：
 *
 * > 思维链：**原歌词以"不属于思考链的内容"出现** → 被他**改写**成 `hmm, maybe …`；
 * > **原歌词只进 memory**
 *
 * 所以这一格记的是**原歌词**（不是改写后的那几句 —— 改写住在他的思维链里，在左格）。
 * 两条记录分别落在两句歌词的帧上：**586**（`These feelings I have for you`）与
 * **642**（`But you don't feel the same`）。
 *
 * ⚠️ **为什么记在"听到那一帧"而不是"改写那一帧"**：文档只说"原歌词只进 memory"，
 * 没说时刻。取歌词帧的理由是这一格是**记忆**（他听到了就记住了），
 * 而且它与画面轴对齐得更干净（记录的时刻 = 那一句开口的时刻）。
 * 要挪到改写帧（590 / 646）就是改这张表的 `n`。
 *
 * ⚠️ **表在这里重复了一遍**（`film/pages/act1.js` 的 `CONTEXT_EVENTS` 是同一批字符串）。
 * 这不是懒：`AGENTS.md` §2 规则 12 规定 `film/content/` 只许调 `kit/` 与 `engine/`，
 * 不许 import 页面侧（那是浏览器世界）。两份的**一致性由测试守着**
 * （`film/test/cursor.test.js`：逐条比对 `n` 与 `text`）—— 那比一个跨世界的 import 干净。
 *
 * ## 画法
 *
 * 底色 / 边界 / 标题行由 `content/panels.js` 画（T4 的空面板标准），这里只画**行**。
 * 字体走**我们的世界**那一套（Consolas，`design-options.md` §4.3）——
 * 右列是 canvas 侧，也就是"不是 dsh 界面"的那一半。
 */

import { CELLS, PANEL, isThreeCell } from '../engine/layout.js';
import { drawText, glyphAtlas, registerFont, resolveFontFile } from '../kit/text.js';
import { PANEL_COLORS } from './panels.js';

/**
 * memory 的记录（**只增不减**：§三"唯一会累积"）。
 * `n` = 记录出现的那一帧；`text` = **原歌词**。
 * @type {readonly {n: number, text: string}[]}
 */
export const ENTRIES = [
  { n: 586, text: 'These feelings I have for you' },
  { n: 642, text: "But you don't feel the same" },
];

/** 记录文本的字号（px）。@type {number} */
export const MEMORY_TEXT_SIZE = 16;

/** 记录的行高（px；整数，行位置 = 首行顶 + i × 行高）。@type {number} */
export const MEMORY_LINE_H = 26;

/** 首行顶距面板标题行下沿的距离（px）。@type {number} */
export const MEMORY_PAD_TOP = 12;

/** 记录文本的颜色 —— 用面板正文色（`PANEL_COLORS.title`），不自己发明一个色。 */
export const MEMORY_TEXT_COLOR = PANEL_COLORS.title;

/**
 * 第 `n` 帧这一格里有几条记录。
 * @param {number} n
 * @returns {{n: number, text: string}[]}
 */
export function memoryRowsAt(n) {
  return ENTRIES.filter((e) => n >= e.n);
}

/** 记录里用到的全部字符（图集只烤一次，**与 n 无关**，所以缓存它不破坏纯函数）。 */
const CHARS = [...new Set(ENTRIES.map((e) => e.text).join(''))].join('');

/** @type {?any} */
let atlas = null;

/** @returns {any} 记录用的字形图集 */
function memoryAtlas() {
  if (atlas) return atlas;
  const monoPath = resolveFontFile(['consola.ttf', 'Consolas.ttf']);
  atlas = glyphAtlas(registerFont(monoPath, MEMORY_TEXT_SIZE, 'memory-mono'), CHARS);
  return atlas;
}

/**
 * 两条记录在面板里的**矩形**（测试与探针用它裁图）。
 * 行位置：`x = 面板左缘 + PANEL.pad`、`y = 面板顶 + PANEL.titleRow + MEMORY_PAD_TOP + i × MEMORY_LINE_H`。
 * @param {number} i 第几条（0 起）
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function rowRect(i) {
  return {
    x: CELLS.memory.x + PANEL.pad,
    y: CELLS.memory.y + PANEL.titleRow + MEMORY_PAD_TOP + i * MEMORY_LINE_H,
    w: CELLS.memory.w - 2 * PANEL.pad,
    h: MEMORY_LINE_H,
  };
}

/**
 * 把这一格里的记录画进画面。**没有记录时什么都不画**（T4 的"内容为空"标准照旧成立）。
 * @param {import('../engine/frame.js').FrameState} s
 * @returns {{rows: number}} 这一帧画了几条
 */
export function drawMemory(s) {
  // 版面没到位（引子的拉远途中）就还没有这一格 —— 与 panels.js 同一条判据
  if (!isThreeCell(s.n)) return { rows: 0 };
  const rows = memoryRowsAt(s.n);
  if (rows.length === 0) return { rows: 0 };
  const a = memoryAtlas();
  rows.forEach((r, i) => {
    const rect = rowRect(i);
    drawText(s.stack.chrome, a, { x: rect.x, y: rect.y }, r.text, { color: MEMORY_TEXT_COLOR });
  });
  return { rows: rows.length };
}

/** 自述（报告 / 探针用）。 @returns {string} */
export function describe() {
  return [
    `memory 格：${ENTRIES.length} 条记录（原歌词只进 memory —— §2.2）`,
    ...ENTRIES.map((e) => `  帧 ${String(e.n).padStart(4)}  ${e.text}`),
    `  面板 ${CELLS.memory.w}×${CELLS.memory.h} @(${CELLS.memory.x},${CELLS.memory.y}) · 行高 ${MEMORY_LINE_H} · 字号 ${MEMORY_TEXT_SIZE}`,
  ].join('\n');
}
