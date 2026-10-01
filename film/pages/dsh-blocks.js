/**
 * film/pages/dsh-blocks.js — 引子要用的 **dsh 组件块**（Phase 5 / R1）。
 *
 * 每个函数产出一段 HTML，类名**全部取自抽出来的真 CSS**（`film/vendor/dsh-css/dsh.css`），
 * 所以它们是 dsh 自己的样式，不是我们仿的。
 *
 * ## 设计边界（重要）
 *
 * 这些是**最小可用**的块，不是 dsh 界面的完整复刻：
 * 只做引子（帧 0–419）需要的那几样。加新块的门槛是「引子里真的要用」，
 * 不是「dsh 里有」。
 *
 * ## 两层：行级（`*Line`）与块级
 *
 * 引子的滚动区是一列**固定 24 px 的行**（见 `intro.js` 文件头），所以引子只用**行级**函数：
 * 它们返回一个完整的 `.stage__line` 元素，行高由页面 CSS 钉死（`height:24px`）。
 *
 * 块级函数（`disclosureRow` / `toolDetails` / `userBubble`）**不进引子的滚动区** ——
 * 它们自带内边距与行高（`.DXqwVW_item` 是 10px+14px、`.Sixlwa_bubble` 是 22px 行高），
 * 放进行网格里会让「内容高 = 24 × 行数」这条等式失效，而滚动位置的可证明性就建立在它上面。
 * 它们保留下来给**别的页面**用，并且仍由 `probe-r1-first-frame.mjs` 守着（那是它们的判据）。
 *
 * ## 已核实的类名契约（从 dsh.css 里读出来的，不是猜的）
 *
 * | 块 | 类名 | 从 CSS 读到的关键性质 |
 * |---|---|---|
 * | 披露行 | `.lcKema_root` / `_row` / `_leading` / `_title` / `_summaryText` / `_chevron` / `_separator` / `_thinkBody` | `_root:not([data-expanded]){height:calc(24px + …)}`；`_summary` 只在 `[data-preview]` 下显示；`_thinkBody{padding:4px 0 4px calc(22px + …)}` |
 * | 正文 | `.ZkiH0q_text` | `color:var(--dsw-alias-label-secondary);font:inherit;white-space:pre-wrap;margin:0` —— **`font:inherit` 是关键**：行高从 `.stage__line` 继承，网格才成立 |
 * | 键值行 | `.ZkiH0q_field` / `_fieldKey` / `_fieldValue` | `_field{display:flex;gap:8px}`；`_fieldKey{min-width:96px;color:label-caption}`；`_fieldValue{color:label-tertiary}` |
 * | 代码块 | `.DXqwVW_root` / `_list` / `_item` | `border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-markdown-code-block)`；`_item{padding:10px 14px}` |
 * | 用户气泡 | `.Sixlwa_userRow` / `.Sixlwa_bubble` | `line-height:calc(22px + delta)`；`padding:10px 16px`；`background:var(--dsw-specific-bubble)` |
 *
 * ## 纪律
 *
 * - **纯函数**：同参数 → 逐字符相同的 HTML（页面是 `t` 的纯函数，块也必须如此）。
 * - **转义**：所有文本走 `esc()`，不要手拼字符串。
 * - **不写内联颜色/圆角/间距** —— 那就不再是 dsh 的样子了；要调就调类名选错的地方。
 *   唯一的例外是**页面自己的网格**（`.stage__line` 的 24 px），它不是 dsh 的样式，是我们的排版契约。
 */

/** 网格行的类名。引子的排版契约，见 `intro.js`。 */
export const GRID_LINE = 'stage__line';

/**
 * 「结构格」的类名：**只有格子的尺寸，没有排版属性**。
 *
 * 存在的原因是踩过一次：`.stage__line` 带 `white-space:pre`（为了让行不折行），
 * 而 `white-space` 是**可继承**的。第一版把整个 `.lcKema_root` 包进一个 `.stage__line`，
 * 于是 `pre` 漏进思维链正文 —— 正文里每两个 `.stage__line` 之间的换行符被当成**真换行**，
 * 每一行后面多出 20 px 的匿名行盒（44 px 一步，而不是 24），
 * 「内容高 = 24 × 行数」当场失效（`--intro-scroll-check` 抓到，实测差 23 px→320 px）。
 *
 * 纪律：**格子里放块级组件时用 `stage__gridbox`；只有一行纯文本时才用 `stage__line`。**
 */
export const GRID_BOX = 'stage__gridbox';

// 只为了「固定区恰好 5 行」这条自检 —— `intro.js` 是纯数据与纯函数，不会反向依赖这里。
import { FIXED_LINES } from './intro.js';


/**
 * HTML 转义（`&<>"`）。dsh 的正文里会出现 `<system-reminder>` 这种字面标签，
 * 不转义就会被浏览器当标签吃掉。
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 正文段落（`.ZkiH0q_text`）。块级版本 —— 自带 `<p>`，**不要**放进行网格。
 * @param {string} text
 * @param {{tone?: 'secondary'|'tertiary'}} [opts]
 * @returns {string}
 */
export function text(text, opts = {}) {
  const cls = opts.tone === 'tertiary' ? 'ZkiH0q_text ZkiH0q_fieldValue' : 'ZkiH0q_text';
  return `<p class="${cls}">${esc(text)}</p>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 行级：一个函数 = 一个完整的 `.stage__line`（引子的滚动区与固定区都只用这些）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 行级正文。`.ZkiH0q_text` 是 `<span>`（不是 `<p>`）—— 行盒由 `.stage__line` 决定，
 * 内层不许有自己的块级盒，否则「内容高 = 24 × 行数」就不成立。
 * @param {string} s
 * @param {{emphasis?: 'heading'|'lyric'|null, caret?: boolean}} [opts]
 *   `emphasis` 与 `caret` 只写 `data-*` 属性，具体样式在页面的 CSS 里（用 dsh 的令牌，不写死颜色）
 * @returns {string}
 */
export function textLine(s, opts = {}) {
  const em = opts.emphasis ? ` data-emphasis="${opts.emphasis}"` : '';
  // 光标挂在**文字元素**上（不是行盒）：`::after` 才紧跟在文字后面
  const caret = opts.caret ? ' data-caret="1"' : '';
  return `<div class="${GRID_LINE}"${em}><span class="ZkiH0q_text"${caret}>${esc(s)}</span></div>`;
}

/**
 * 行级键值行（`.ZkiH0q_field`）。dsh 里 `Instructions from: <路径>` 就是这种形状
 * （`design-options.md` §1.5：真实字符串是 `Instructions from: <path>`）。
 *
 * ⚠️ 光标必须挂在 `fieldValue` 上：`.ZkiH0q_field` 是 flex 容器，
 * 挂在行盒上会让 `::after` 掉到 flex 容器的**下一行**（行盒变两行，网格就崩了）。
 * @param {string} key
 * @param {string} value
 * @param {{caret?: boolean}} [opts]
 * @returns {string}
 */
export function kvLine(key, value, opts = {}) {
  const caret = opts.caret ? ' data-caret="1"' : '';
  return (
    `<div class="${GRID_LINE}"><span class="ZkiH0q_field">` +
    `<span class="ZkiH0q_fieldKey">${esc(key)}</span>` +
    `<span class="ZkiH0q_fieldValue"${caret}>${esc(value)}</span>` +
    `</span></div>`
  );
}

/** 空行（占一个网格行）。 */
export function blankLine() {
  return `<div class="${GRID_LINE}"></div>`;
}

/**
 * 把 `intro.js` 的纯文本行渲染成网格行。
 *
 * 结构是从内容里**认**出来的（不是另写一张类型表 —— 那样内容一改就会漂）：
 * - `Instructions from: X` → 键值行
 * - 空串                 → 空行
 * - 其余                 → 正文行
 *
 * ## `bare` 为什么存在（实测教训）
 *
 * `.ZkiH0q_text` 是 **ContextBody（上下文注入）** 的类，它自带
 * `color:var(--dsw-alias-label-secondary)`。第一版对**所有**行都用它，
 * 于是助手回复也变成了 secondary 灰（正确的布是 `.markdown` 的 `label-primary`），
 * 实测：`rgb(207,211,214)` 而不是 `rgb(249,250,251)` —— 在深色底上看起来像"糊"，
 * 其实是颜色错了一档。
 *
 * 所以：**注入的 context 用 `ZkiH0q_text`；助手回复与思维链用 `bare`**
 * （不套 span，让外面那层 markdown 容器给颜色与字号 —— 那才是真 dsh 的结构）。
 *
 * ⚠️ `# 标题` 这类 markdown 记号**不**特殊处理：真实 dsh 的 ContextBody 就是
 * `white-space:pre-wrap` 的纯文本，`##` 会原样显示。而且 §1.8 要求这份文档
 * 「大部分行可辨识但读不清」—— 给它加一套标题层级是我们**自己发明**的排版。
 * @param {string} line
 * @param {{emphasis?: 'lyric'|null, bare?: boolean, caret?: boolean}} [opts]
 * @returns {string}
 */
export function autoLine(line, opts = {}) {
  const em = opts.emphasis ? ` data-emphasis="${opts.emphasis}"` : '';
  if (line === '' && !opts.emphasis) return `<div class="${GRID_LINE}"></div>`;
  const kv = !opts.bare && /^(Instructions from|Additional instructions from|Updated instructions from): (.*)$/.exec(line);
  if (kv) return kvLine(kv[1], kv[2], { caret: opts.caret });
  if (opts.bare) {
    const caret = opts.caret ? ' data-caret="1"' : '';
    return `<div class="${GRID_LINE}"${em}${caret}>${esc(line)}</div>`;
  }
  return textLine(line, { emphasis: opts.emphasis, caret: opts.caret });
}


/**
 * 披露行 / 折叠行（`.lcKema_*`）—— 引子的「context」那一块用它。
 *
 * 结构是从真 CSS 的选择器契约反推的最小形态：
 * `.lcKema_root[data-expanded] [data-open] [data-disclosure-row]` 说明
 * 展开态靠 `data-expanded` / `data-open` / `data-disclosure-row` 三个属性。
 * @param {{title: string, summary?: string, expanded?: boolean, running?: boolean, body?: string}} o
 * @returns {string}
 */
export function disclosureRow(o) {
  const state = o.running ? 'running' : 'ok';
  const expanded = o.expanded ? '<div data-open>' : '<div>';
  return `
<div class="lcKema_root" data-variant="context" data-state="${state}"${o.expanded ? ' data-expanded' : ''}>
  ${expanded}
    <div class="lcKema_row" data-disclosure-row="true" data-expandable="true" role="button">
      <span class="lcKema_leading"><span class="lcKema_chevron">▾</span></span>
      <span class="lcKema_title">${esc(o.title)}</span>
      <span class="lcKema_summary"><span class="lcKema_summaryText">${esc(o.summary ?? '')}</span></span>
    </div>
  </div>
  ${o.expanded && o.body ? `<div>${o.body}</div>` : ''}
</div>`.trim();
}

/**
 * **工具详情列表**（`.DXqwVW_*`）—— 不是代码块！
 *
 * 名字改正过一次：`DXqwVW` 是 `dsh-client-ui-tool` 的 `ToolDetails.module.css`
 * （工具调用的详情：字段 / 徽标 / diff / 正文），真正的 markdown 代码块在外壳 CSS 里
 * （`_block_<hash>_<n>` + 全局类 `md-code-block`，见 `dsh-theme.js` 的 `shellClass()`）。
 *
 * 引子用不到它；留着是因为「工具调用的那一段」在崩坏段大概率要用，
 * 而 `probe-r1-first-frame.mjs` 用它守「有边框/圆角/底色的 dsh 容器能渲出来」这条判据。
 * @param {{lines: string[], caption?: string}} o
 * @returns {string}
 */
export function toolDetails(o) {
  const items = o.lines.map((l) => `<li class="DXqwVW_item">${esc(l)}</li>`).join('');
  return `
<div class="DXqwVW_root"${o.caption ? ' data-caption="true"' : ''}>
  ${o.caption ? `<div class="DXqwVW_caption">${esc(o.caption)}</div>` : ''}
  <ul class="DXqwVW_list">${items}</ul>
</div>`.trim();
}

/**
 * 用户消息行（`.Sixlwa_userRow` + `.Sixlwa_bubble`）—— 引子里的署名行 / 之后她的话。
 * @param {{text: string, author?: string}} o
 * @returns {string}
 */
export function userBubble(o) {
  return `
<div class="Sixlwa_userRow">
  ${o.author ? `<div class="ZkiH0q_text ZkiH0q_fieldKey">${esc(o.author)}</div>` : ''}
  <div class="Sixlwa_bubble">${text(o.text)}</div>
</div>`.trim();
}

/**
 * 间距块 —— dsh 的 CSS 不给「两条消息之间」加间距（那是外层 flex gap 的活）。
 * 我们不给内联 margin（那会破坏纪律），而是用 dsh 自己的一个 gap 容器类名。
 *
 * ⚠️ 如果 CSS 里找不到合适的 gap 容器，就**老实返回空字符串**并在文档里记一笔 ——
 * 宁可现在排版丑一点，也不要自己编一套间距（那会随时间越编越多）。
 * @returns {string}
 */
export function spacer() {
  // `.lcKema_root` 自带 `flex-direction:column;display:flex`（无 gap），
  // `.ZkiH0q_fields` 自带 `gap:2px` —— 都不是通用的「消息行间距」。
  // 结论：dsh 的间距来自外层容器的 flex gap，我们暂时不复制它，先留空。
  return '';
}

/**
 * 组装成一段「消息流」列（`.dsh-col` 由 `dsh-theme.js` 定义）。
 * @param {string[]} parts
 * @returns {string}
 */
export function column(parts) {
  return `<div class="dsh-col">${parts.filter(Boolean).join('\n')}</div>`;
}

/**
 * 引子的**固定区**（`design-options.md` §1.6/§1.8 定的内容）：
 *
 * - `Instructions from: AGENTS.md`
 * - 三行署名：`视频：Pen-NineCat` / `词曲：s0rrow` / `Remix：69岁牢二次元`
 * - `You are a ...`（**真被 maxBytes 截断**，不是留白）
 *
 * 三条硬性质：
 * 1. **恰好 `intro.FIXED_LINES` 行**（现在是 5）—— 固定区高必须是个能算出来的数，
 *    否则滚动窗口高就无从谈起（见 `intro.js` 文件头）。
 * 2. **不随滚动变化**（本人指定：它属于重要信息）—— 所以它**不在滚动容器里**（由 `body.js` 隔开）。
 * 3. **是引子里最清楚的三行**（§1.8）：署名行给 `data-emphasis="signature"`，
 *    其余行是机器文本、压到 tertiary。这几个属性只是标记，样式在页面 CSS 里。
 * @param {{signature?: [string, string, string], youAre?: string, from?: string}} [o]
 * @returns {string} 恰好 5 个 `.stage__line`
 */
export function fixedHeader(o = {}) {
  const sig = o.signature ?? ['视频：Pen-NineCat', '词曲：s0rrow', 'Remix：69岁牢二次元'];
  const youAre = o.youAre ?? 'You are a software engineering agent. Use the tools';
  const from = o.from ?? 'AGENTS.md';
  const lines = [
    kvLine('Instructions from', from),
    ...sig.map((s) => textLine(s, { emphasis: 'signature' })),
    textLine(youAre),
  ];
  if (lines.length !== FIXED_LINES) {
    throw new Error(
      `fixedHeader(): 生成了 ${lines.length} 行，` +
        `而 intro.FIXED_LINES 是 ${FIXED_LINES} —— 固定区高会算错，滚动位置就不对了。\n` +
        `  hint: 要加行就同时改 intro.js 的 FIXED_LINES`,
    );
  }
  return lines.join('\n');
}

/**
 * 思维链的**披露行**（`.lcKema_*`），展开态、running 态 —— 引子第 2 拍用它。
 *
 * ## 每个属性都是 CSS 读出来的硬要求（不是审美选择）
 *
 * - `data-expanded` → 去掉 `.lcKema_root:not([data-expanded])` 的 `height:24px` + `contain:size`，
 *   正文才看得见；
 * - `data-state="running"` → `.lcKema_row:after` 拿到那条 **2.6 s 的扫描动画**；
 * - `data-open` + `data-disclosure-row` → **裸属性选择器**，靠祖先后代关系让表头吸顶。
 *
 * ## 展开态**不渲染** summary（改正过一次）
 *
 * 第一版按 `.lcKema_root:not([data-preview])` 的规则以为要加 `data-preview` 才看得见摘要。
 * 读了 primitives 的 `DisclosureRow` 才知道：展开时 `(keepContentWhenOpen || !open) && collapsedContent`
 * 为假 → 真 DOM 里**根本没有** `.lcKema_separator` / `.lcKema_summary`。
 * 所以这里也不渲染它们 —— 加 `data-preview` 反而是**多出来的东西**。
 *
 * ⚠️ 那条扫描动画是引子页面上**唯一的 CSS 动画**，也就是七个焊点里**第 3 个焊点**
 * 在 R1 上的真实靶子（以前只有探针页里那个自己编的方块）。它在
 * `@media (prefers-reduced-motion:reduce)` 里会被 `animation:none` 关掉 ——
 * 所以截图器**不能**打开 `reducedMotion: 'reduce'`（那会静默地让帧不再依赖 `t`）。
 *
 * ## 没做的两件事（记账）
 *
 * - **表头不吸顶**：真吸顶要 `.lcKema_root[data-expanded] [data-open] [data-disclosure-row]`
 *   满足，而它需要外壳的 `._row_luwio_16` 那套行类（`position:relative` 好办，行高则要另外解析）。
 *   现在表头放在一个 24 px 的网格行里 —— 需要吸顶时把行盒换成外壳行类即可。
 * - **图标**来自 dsh 的图标注册表（`IconThinkOutlineRegular`），**任何 CSS 里都没有**，
 *   所以这里用字符 `▾`（不是 emoji）。
 * @param {{title?: string, running?: boolean}} [o]
 * @returns {string}
 */
export function thinkingHead(o = {}) {
  const title = o.title ?? 'Thinking';
  const state = o.running === false ? 'ok' : 'running';
  // 表头占**一格结构格**：`[data-open]` 本身就是个没有样式的属性载体，
  // 给它挂上 `stage__gridbox` 就能把行高钉死在 24 px（见 `intro.THINK_HEAD_LINES` 的实测教训：
  // 不钉的话 `▾` 的字形度量会把它撑成 23 px）。
  // ⚠️ 结构格**不能**包住整个 `.lcKema_root`（思维链正文比 24 px 高得多，会被 overflow:hidden 裁掉）。
  // 这一层 `.lcKema_root` 保持不闭合，正文由 `THINK_BODY_OPEN` 接着写。
  return [
    `<div class="lcKema_root" data-variant="think" data-state="${state}" data-expanded="true">`,
    `  <div class="${GRID_BOX}" data-open="true">`,
    `    <div class="lcKema_row" data-disclosure-row="true" data-expandable="true" role="button" tabindex="0" aria-expanded="true">`,
    `      <span class="lcKema_leading"><span class="lcKema_chevron">▾</span></span>`,
    `      <span class="lcKema_title">${esc(title)}</span>`,
    `    </div>`,
    `  </div>`,
  ].join('\n');
}

/** 思维链正文的容器（`.lcKema_thinkBody`，自带 `padding:4px 0 4px 22px`）。 */
export const THINK_BODY_OPEN = '<div class="lcKema_thinkBody">';
/**
 * 思维链正文容器的收尾：关掉正文容器、`.lcKema_root`（由 `thinkingHead` 打开）。
 * @type {string}
 */
export const THINK_BODY_CLOSE = '</div></div>';

