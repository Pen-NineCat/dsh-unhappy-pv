/**
 * film/pages/dsh-composer.js — R1 的**输入框**（画面规格 §2.1 的渲染分工 + §2.3 的幕间舞台）。
 *
 * ## 为什么引子里就要它（作者 2026-10-01 定：选 B）
 *
 * §2.1 把"整块 dsh UI"枚举成「固定区、滚动文档、对话、输出、思维链」，**没提输入框**，
 * 所以我第一版省掉了它（记录 25）。作者看了动态检查后选了 **B：加输入框、不加侧栏**。
 * 理由不止"像"：**§2.3 的幕间整段建立在"她发一条文本 → 拿到和插件一样的错误 → `disable`"之上**，
 * §2.2 的 `D3` 也是「输入框里逐字出现「我这边下雨了」，随后被逐字退格删掉」——
 * 那条通道迟早要出现，早一点建好、早一点能在成片里对齐。
 *
 * ## 类名与结构是**量出来的**，不是猜的
 *
 * `film/test/probe-chrome.mjs --dump-composer`（真 `dsh web`、960×640）实测的树：
 *
 * ```
 * div.uV2eYG_root            744×114   （非 hero 态时输入区 min-height 36 而不是 52）
 *   div.uV2eYG_card          712×114   r=28px  padding-top 8   [data-composer-card]
 *     div.uV2eYG_overlayAnchor 712×0
 *     div.uV2eYG_scroll      708×52     [data-input-scroll]
 *       div.uV2eYG_grow      708×52
 *         div.uV2eYG_input   708×52     padding 4/8/0/14   ← 有 caret-color
 *         div.uV2eYG_placeholder 686×25 "…"
 *     div.uV2eYG_row         712×42     padding 2/8/6/8
 *       div.uV2eYG_tools     140×28  →  button.uV2eYG_add 28×28 圆 · div.uV2eYG_modes
 *       div.uV2eYG_trailing  238×34  →  div.uV2eYG_standardControls · button.uV2eYG_primary 34×34 圆
 * ```
 *
 * 图标（`+`、发送箭头、模型图标）**不在任何 CSS 里**（来自 dsh 的图标注册表），
 * 所以按钮里放的是字符（`+` / `↑`）—— 与思维链表头用 `▾` 同一个处理。
 *
 * ## 语言：**中文**（dsh 自己的 UI 文案是中文，§1.1）
 *
 * 这台机器上真界面就是 zh locale（placeholder「描述你想要构建的内容…」、权限「完全权限」）。
 * 所以这里的文案 = **实测到的那几串**，集中在 `COMPOSER_TEXT` 一处。
 * ⚠️ 旧口径（记录 26）是"机器文本一律英文"，那是按当时的 §0 写的；§1.1 已经把它反过来，
 * 而 §2.3 还专门纠正过：「（**不是**"全片唯一的中文句子是人打的"——dsh 的 UI 文案本来就是中文）」。
 * 唯一不是中文的是 `model`（`DeepSeek-V41-Flash High` 是**模型目录里的 real id 名**，本来就英文）。
 */

/**
 * 输入框里的产品文案。**唯一一处**。
 *
 * ## `permission`：取「**完全权限**」（作者 2026-10-01 拍板，A1）
 *
 * 上一轮这里取的是英文 `Full access`，理由是 §2.2/§3 把它当成**语义对**引用：
 * 🎯「两个权限词配成一对：`Full access`（**她**开的门）／`403`（**他**关的窗）」，
 * §2.4 又说「`Full access` 是崩坏的语义前提」。但真界面在这台机器上显示的是「**完全权限**」，
 * 而 §1.1 的硬约束是"**dsh 的 UI 文案是中文**"。
 *
 * 作者拍板：**用真界面实显的那串**「完全权限」。所以：
 * - 这一行不再是我"按语义对猜的英文"，而是**实测到的产品文案**；
 * - ⚠️ 由此 §2.2/§2.4 里写作 `Full access` 的那几处**与片子不一致**了 ——
 *   那两处的语义（"她开的门"、"崩坏的前提"）不受影响，但**字面要改**（已报作者）。
 */
export const COMPOSER_TEXT = {
  placeholder: '描述你想要构建的内容, / 调用指令, @ 文件或对话',
  permission: '完全权限',
  model: 'DeepSeek-V41-Flash High',
  add: '+',
  send: '↑',
};

/**
 * 输入框的 DOM。
 *
 * 结构照实测那一棵；**不加 `uV2eYG_hero`** —— 我们的会话是有内容的（不是空会话的首屏），
 * 那个类会把输入区 min-height 从 36 顶到 52、placeholder 变成居中两行。
 *
 * ## `input`：她打的字（画面规格 §2.2 / §三）
 *
 * 引子里 `input` 永远是空串（输入框空着 = "她在，但没说话"，O1 的载体之一）；
 * 第一幕 `[419, 484)` 她**打了字又删掉**（`act1.inputTextAt(n)`），之后又是空的。
 * 有字的时候**不画 placeholder**（真界面也是这个行为）。
 *
 * ## `caret`：焦点在她身上时才有文字光标，而且**会闪**（§三「焦点」）
 *
 * 亮不亮由 `act1.inputCaretOn(n)` 算（纯 `n` 的方波，见 `caret.js`）。
 * ⚠️ 光标是**伪元素**（`::after`），所以它不进 HTML 的文本、也不会被复制；
 * 这里只挂一个 `data-caret` 属性，形状与尺寸钉死在 `body.js` 的 pageCss 里
 * （2px × 1em —— 不钉死会被字形度量撑高，`▾` 那次就是这么翻的车）。
 * @param {{text?: typeof COMPOSER_TEXT, input?: string, caret?: boolean}} [o]
 * @returns {string}
 */
export function composerHtml(o = {}) {
  const t = o.text ?? COMPOSER_TEXT;
  const input = o.input ?? '';
  return `
<div class="uV2eYG_root" data-dsh-composer="true">
  <div class="uV2eYG_card" data-composer-card="true">
    <div class="uV2eYG_overlayAnchor"></div>
    <div class="uV2eYG_scroll" data-input-scroll="true">
      <div class="uV2eYG_grow">
        <div class="uV2eYG_input" data-composer-input="true" data-input-len="${input.length}"${o.caret ? ' data-caret="1"' : ''}>${esc(input)}</div>
        ${input ? '' : `<div class="uV2eYG_placeholder" data-composer-placeholder="true">${esc(t.placeholder)}</div>`}
      </div>
    </div>
    <div class="uV2eYG_row">
      <div class="uV2eYG_tools">
        <button type="button" class="uV2eYG_add" aria-label="Attach">${esc(t.add)}</button>
        <div class="uV2eYG_modes"><button type="button" class="uV2eYG_select">${esc(t.permission)}</button></div>
      </div>
      <div class="uV2eYG_trailing">
        <div class="uV2eYG_standardControls"><button type="button" class="uV2eYG_select">${esc(t.model)}</button></div>
        <div class="uV2eYG_activity"></div>
        <button type="button" class="uV2eYG_primary" aria-label="Send">${esc(t.send)}</button>
      </div>
    </div>
  </div>
</div>`.trim();
}

/**
 * HTML 转义（`&<>"`）。与 `dsh-blocks.esc` 同一份行为的本地副本 ——
 * 这里只为了避免 `dsh-composer → dsh-blocks` 的反向依赖（`dsh-blocks` 已经 import 了 `intro`）。
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 输入框那几条**我们自己的** CSS（dsh 的 `uV2eYG_*` 规则已经在外壳 CSS 里，不用抄）。
 *
 * 只做三件 dsh 不做的事：
 * 1. 把外层高度钉成 `--stage-composer-h`（**网格算术需要它是常数**，见 `intro.js` 文件头）；
 * 2. `placeholder` 按实测的 `inset` 定位（dsh 用绝对定位，父级要有 `position:relative`，
 *    那个 `uV2eYG_grow{position:relative}` 已经在外壳 CSS 里）；
 * 3. 按钮里的字符居中（图标本来是 SVG）。
 * @returns {string}
 */
export function composerCss() {
  return `
/* ── 输入框（R1 的 composer，类名与规则都来自 dsh 外壳 CSS 的 uV2eYG_*）──
   我们只加两条 dsh 不做的事：
   1. 外层高度钉成 --stage-composer-h（网格算术要求它是常数，见 intro.js 文件头）；
   2. 字符当图标用时（+ / ↑，SVG 不在任何 CSS 里）给个 line-height:1，免得撑高按钮。 */
.stage__composer { flex: 0 0 auto; height: var(--stage-composer-h); overflow: hidden; padding: 0 0 8px; }
.uV2eYG_add, .uV2eYG_primary { font: inherit; line-height: 1; }`.trim();
}
