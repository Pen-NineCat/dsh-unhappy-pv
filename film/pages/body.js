/**
 * film/pages/body.js — `body(n) -> HTML`：**逐帧页面的纯函数**（Phase 5 / R1）。
 *
 * 规则（`AGENTS.md` §2 规则 6 + 施工说明 §6 Phase 5）：
 * - **纯函数**：同样的 `(n, opts)` 必须给出**逐字符相同**的 HTML。
 *   不要 `Date.now()`、不要 `Math.random()`、不要「上一次渲染了什么」。
 * - **滚动不用 CSS 动画、也不用 `position: sticky`**：
 *   固定区放在滚动容器**之外**，滚动位置每帧由 `t` 直接算出来（`design-options.md` §1.6）。
 *   理由：CSS 动画跟随真实时间，是逐帧渲染的毒药；而直接设滚动位置天然是 `t` 的纯函数。
 * - **资源全本地**：`/vendor/...` 由 `shot.mjs` 的静态服务器挂载 `film/vendor/`（焊点 7）。
 *
 * ## 两个变体
 *
 * | 变体 | 是什么 | 谁用 |
 * |---|---|---|
 * | **`intro`（默认）** | **引子的真页面**（帧 0–419，见 `intro.js`） | 成片、`gen-frames.js`、`shot.mjs` |
 * | `probe` | 截图管线的回归夹具（自己编的方块与行，不是 dsh 界面） | `--jitter-check` / `--scroll-check` |
 *
 * 探针留在 `probe.js` 而不是删掉：R1 的引子页上唯一的 CSS 动画在伪元素上，
 * **读不出角度**，做不了「角度必须随 `n` 变」那条量化断言（见 `probe.js` 文件头）。
 */

import { FPS } from '../engine/clock.js';
import * as intro from './intro.js';
import {
  THINK_BODY_CLOSE,
  THINK_BODY_OPEN,
  autoLine,
  fixedHeader,
  thinkingHead,
} from './dsh-blocks.js';
import { probeBody, probeCss, probeScroll } from './probe.js';
import { composerCss, composerHtml } from './dsh-composer.js';
import { markdownRootClass } from './dsh-theme.js';

/** 可用变体。 */
export const VARIANTS = ['intro', 'probe'];

/**
 * @typedef {Object} BodyOptions
 * @property {'intro'|'probe'} [variant] 页面变体，默认 `intro`
 * @property {number} [width] 视口宽（CSS px），默认 960
 * @property {number} [height] 视口高，默认 640
 * @property {'dark'|'light'} [theme] 主题（`intro` 用：深色靠 `body[data-ds-dark-theme]`）
 * @property {?number} [scrollPx] 覆盖每帧算出来的滚动位置（测试用）
 */

/**
 * 引子第 `n` 帧属于哪一拍。**与 `engine/content.js` 的段边界一一对应**。
 * @param {number} n
 * @returns {'inject'|'think'|'output'|'after'}
 */
export function beatAt(n) {
  if (n < intro.MARKS.think) return 'inject';
  if (n < intro.MARKS.output) return 'think';
  if (n < intro.MARKS.firstLyric) return 'output';
  return 'after';
}

/**
 * 第 `n` 帧的滚动位置（CSS px）—— `t` 的纯函数。
 *
 * 引子版把「最新吐出来的那一行压在窗口底部」（见 `intro.scrollAtFrame`）；
 * 探针版是一条 3 px/帧 的线性推进（见 `probe.probeScroll`）。
 * @param {number} n 帧号
 * @param {BodyOptions} [opts]
 * @returns {number}
 */
export function scrollAtFrame(n, opts = {}) {
  if ((opts.variant ?? 'intro') === 'probe') return probeScroll(n);
  return intro.scrollAtFrame(n, { height: opts.height ?? 640 });
}

/**
 * 缓存一次「解析出来的 shell 类名」。**不是跨帧状态**，是配置：
 * 它只依赖 `film/vendor/` 里的 CSS 文件，不依赖 `n`（同 `AGENTS.md` §7 的常量缓存）。
 * @type {?{markdown: string, source: string}}
 */
let shellClasses = null;

/**
 * 取外壳 CSS 里的类名（**不硬编码 hash**）。
 *
 * `_markdown_1ypvv_5` 这种名字是 vite 的作用域产物，升级前端就会变
 * （`AGENTS.md` §6 已经因为同样原因要求「扫 `assets/` 现取」文件名）。
 * 所以这里按**规则内容**去找类名。
 * @returns {{markdown: string, source: string}}
 */
function shell() {
  if (!shellClasses) shellClasses = markdownRootClass();
  return shellClasses;
}

/**
 * 渲染一个块的某一行（`text` 省略时用该行的原文）。
 *
 * 逐字吐出靠的就是这里的 `text` 参数：把**已吐出的前缀**交给 `autoLine`。
 * @param {import('./intro.js').Block} b
 * @param {number} i 块内行号
 * @param {number} n 帧号（歌词 emphasis 用）
 * @param {string} [text] 覆盖行文本（半行）
 * @param {boolean} [caret] 是否在这一行末尾挂光标（「正在吐」的那一行）
 * @returns {string}
 */
function renderLine(b, i, n, text, caret) {
  const line = text === undefined ? b.lines[i] : text;
  // 歌词那两行：只在成形窗口里给 emphasis（数值也写进 DOM，方便后期取用）
  const isLyric = b.key === 'thinking' && (i === intro.LYRIC_INDEX_IN_THINK || i === intro.LYRIC_INDEX_IN_THINK + 1);
  const e = isLyric ? intro.lyricEmphasis(n) : 0;
  // 回复与思维链走 `bare`（颜色/字号由外面的 markdown 容器给）；注入的 context 才用 ContextBody 类
  const bare = b.key === 'answer' || b.key === 'thinking';
  let html = autoLine(line, { emphasis: e > 0 ? 'lyric' : null, bare, caret: !!caret });
  if (e > 0) html = html.replace('<div class="stage__line"', `<div class="stage__line" data-lyric="${e.toFixed(2)}"`);
  return html;
}

/**
 * 引子页面的一帧正文（**真页面**）。
 * @param {number} n 帧号
 * @param {BodyOptions} opts
 * @returns {string}
 */
function introBody(n, opts) {
  const width = opts.width ?? 960;
  const height = opts.height ?? 640;
  const win = intro.scrollWindowHeight(height);
  const scroll = opts.scrollPx ?? intro.scrollAtFrame(n, { height });
  const beat = beatAt(n);
  const md = shell().markdown;
  const compact = shell().compact;

  // 各块第一行的**全局**行号（与 `intro.locateLine` 的口径一致）
  /** @type {number[]} */
  const offsets = [];
  let acc = 0;
  for (const b of intro.BLOCKS) {
    offsets.push(acc);
    acc += b.lines.length;
  }

  /** @type {string[]} */
  const parts = [];
  intro.BLOCKS.forEach((b, bi) => {
    const rev = intro.revealAt(b, n);
    if (rev.boxes <= 0) return;
    // 「这一块还在吐」→ 光标挂在它最后渲染出来的那一行末尾。
    // ⚠️ 光标**不另占一行盒**：当光标恰好落在行边界（partial 为空）时挂到最后一行整行上，
    //    否则会多出 24px，行网格算术当场失效（那种帧实测存在，如帧 382）。
    const typing = rev.chars < intro.charsInBlock(b);
    const caretRow = typing ? (rev.partialIndex >= 0 ? rev.partialIndex : rev.full - 1) : -1;
    /** @type {string[]} */
    const rows = [];
    // 整行
    for (let i = 0; i < rev.full; i++) rows.push(renderLine(b, i, n, undefined, i === caretRow));
    // 正在吐的那一行：**只显示已吐出的前缀**（逐字的关键；行盒高与字符数无关，网格不受影响）
    if (rev.partialIndex >= 0) {
      rows.push(renderLine(b, rev.partialIndex, n, rev.partial, rev.partialIndex === caretRow));
    }
    if (b.key === 'answer') {
      // 回复走 dsh 的 markdown 排版（14px/24px、label-primary）—— 行盒仍是我们自己的 24px 网格
      parts.push(`<div class="${md}">\n${rows.join('\n')}\n</div>`);
    } else if (b.thinkBody) {
      // 思维链：披露行（真实 dsh 结构）+ `.lcKema_thinkBody`（22px 左缩进 + 上下 4px）
      //   + compact markdown（13px/20px、label-tertiary —— 真 dsh 的推理正文就是这个变体）
      // 标题是 `思考`（中文）：§1.1 的语言分工里 "dsh 的 UI 文案是中文"，
      // 而 §1.1 举的例子正是「模型产出的内容是英文（**思考 · <English>**）」。
      parts.push(
        `${thinkingHead({ title: '思考' })}\n${THINK_BODY_OPEN}\n` +
          `<div class="${md} ${compact}">\n${rows.join('\n')}\n</div>\n${THINK_BODY_CLOSE}`,
      );
    } else {
      parts.push(...rows);
    }
    void bi;
  });

  return `
<div class="stage" data-variant="intro" data-beat="${beat}" data-revealed="${intro.revealedLines(n)}"
     style="--stage-w:${width}px;--stage-h:${height}px;--stage-scroll-h:${win}px;--line-h:${intro.LINE_H}px;--stage-fixed-h:${intro.FIXED_HEIGHT}px;--stage-composer-h:${intro.COMPOSER_HEIGHT}px">
  <header class="stage__fixed" data-dsh-fixed="true">
    <div class="dsh-col">
      ${fixedHeader({})}
    </div>
  </header>
  <main class="stage__scroll" id="scroll" data-scroll="${scroll}" data-content-height="${intro.contentHeight(n)}">
    <div class="dsh-col">
${parts.join('\n')}
    </div>
  </main>
  <footer class="stage__composer" data-dsh-composer-frame="true">
    <div class="dsh-col">
      ${composerHtml()}
    </div>
  </footer>
</div>`.trim();
}

/**
 * 生成一帧的页面正文。
 *
 * 返回的就是 `<body>` 里的**内容**（不含 `<html>/<head>` 与主题样式）——
 * 挂载点与样式由 `stage.html` / `dsh-theme.js` 提供。
 * 这样第 4 个焊点（相同 body 不重写 DOM）可以直接比对字符串。
 * @param {number} n 帧号
 * @param {BodyOptions} [opts]
 * @returns {string} HTML
 */
export function body(n, opts = {}) {
  if (!Number.isInteger(n)) throw new Error(`body(n): n 必须是整数帧号，收到 ${n}`);
  const variant = opts.variant ?? 'intro';
  if (variant === 'probe') return probeBody(n, opts);
  if (variant !== 'intro') {
    throw new Error(
      `body(): 未知变体 "${variant}"\n` +
        `  hint: 可用变体是 ${VARIANTS.map((v) => `'${v}'`).join(' / ')}` +
        `（'intro' = 引子真页面，'probe' = 截图管线回归夹具）`,
    );
  }
  return introBody(n, opts);
}

/**
 * 页面级 CSS。**内联**在 `stage.html` 里更好（少一次请求、少一个 404 可能），
 * 所以这里给的是字符串，由 `gen-frames.js` 决定怎么用。
 *
 * 两个变体的 CSS **都**给：`out/gen/stage.html` 只生成一次，而 `--jitter-check`
 * 与 `--scroll-check` 会在运行时切到 `probe` 变体 —— 那时没有机会再改这个文件。
 * 类名不冲突（`.stage__*` 与 `.probe__*`），多余的规则不花钱。
 * @returns {string}
 */
export function pageCss() {
  return `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body { font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif); -webkit-font-smoothing: antialiased; }

/* ── intro 变体：舞台 + 24px 行网格 ─────────────────────────────────── */
/* 行网格的 24px 是**排版契约**（见 intro.js 文件头）：内容高 = 24 × 行数，
   所以「滚动位置 = f(t)」在算术上一定成立，不会被浏览器夹住。 */
/* 舞台：整页的字号基线 = dsh 的正文字号变量（真界面里 hWmORq_root / Sixlwa_bubble 也是这么写的）。
   不写这一条，固定区与注入的 context 会退回浏览器默认的 16px —— 实测差 2px，肉眼就是"字号不对"。 */
.stage { display: flex; flex-direction: column; width: var(--stage-w); height: var(--stage-h); overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: var(--dsh-content-font-size, 14px); }
/* 固定区：横跨整宽的一条，但**内容列与滚动区同一左沿**（都走 .dsh-col）——
   不然两块文字会各有各的左边界，看起来像两张拼起来的图。
   分隔线用 dsh 的令牌（真界面里会话头部也是这条 --dsw-alias-border-l3）。 */
.stage__fixed { flex: 0 0 auto; height: var(--stage-fixed-h); overflow: hidden; padding: 12px 0; border-bottom: .5px solid var(--dsw-alias-border-l3, transparent); }
.stage__scroll { flex: 0 0 auto; height: var(--stage-scroll-h); overflow: hidden; overflow-anchor: none; }
.stage__line { height: var(--line-h); line-height: var(--line-h); margin: 0; padding: 0; white-space: pre; overflow: hidden; }
/* 结构格：给「里面还装着 dsh 块级组件」的格子用。
   ⚠️ **不能**带 white-space:pre —— 它是可继承的，会漏进子树，
   把子树里 HTML 之间的换行符变成真换行（每行多 20px，见 dsh-blocks.js 的 GRID_BOX 说明）。
   注：这段 CSS 在 JS 模板字符串里，所以注释里不能出现反引号（附录 C 记录 12）。 */
.stage__gridbox { height: var(--line-h); line-height: var(--line-h); margin: 0; padding: 0; overflow: hidden; }
/* 行内不许有自己的块级盒外距（否则 24px 就不再是行高，网格算术崩掉） */
.stage__line > *, .stage__gridbox > * { margin: 0; }
/* 逐字吐出时的**光标**：挂在文字元素上，::after 才紧跟在最后一个字后面。
   ⚠️ 尺寸必须钉死（2px × 1em），否则行盒会被它撑高（▾ 那次就是这么翻的车，见附录 C 记录 21）。
   颜色走 currentColor（正文自己的颜色），不写死。
   ⚠️ 这段 CSS 在 JS 模板字符串里：**注释里不能有反引号**（附录 C 记录 12，已踩三次）。 */
.stage__line[data-caret]::after,
.ZkiH0q_text[data-caret]::after,
.ZkiH0q_fieldValue[data-caret]::after { content: ""; display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -0.15em; background: currentColor; }
/* emphasis 只改**颜色/字重**，用 dsh 的令牌 —— 不写死颜色（见 dsh-blocks.js 纪律） */
.stage__line[data-emphasis=signature] { color: var(--dsw-alias-label-primary); font-weight: 500; }
.stage__line[data-emphasis=signature] .ZkiH0q_text { color: var(--dsw-alias-label-primary); font-weight: 500; }
.stage__line[data-emphasis=lyric] { color: var(--dsw-alias-label-primary); }
.stage__line[data-emphasis=lyric] .ZkiH0q_text { color: var(--dsw-alias-label-primary); }
/* 居中内容列：dsh 真界面是「侧栏 + 主区」两列，这一页只截主区那一块 */
.dsh-col { max-width: 760px; margin: 0 auto; padding: 0 24px; }

/* ── probe 变体：截图管线的回归夹具（不是成片画面）────────────────── */
${probeCss()}

/* ── 输入框（R1 的 composer）──────────────────────────────────────── */
${composerCss()}`.trim();
}

void FPS;
