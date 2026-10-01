/**
 * film/pages/dsh-composer.js — R1 的**输入框**（`design-options.md` §4.21/§4.22 的舞台）。
 *
 * ## 为什么引子里就要它（作者 2026-10-01 定：选 B）
 *
 * §1.6 把"整块 dsh UI"枚举成「固定区、滚动文档、对话、输出、思维链」，**没提输入框**，
 * 所以我第一版省掉了它（记录 25）。作者看了动态检查后选了 **B：加输入框、不加侧栏**。
 * 理由不止"像"：**§4.21/§4.22 的幕间整段建立在"她发一条文本 → 拿到和插件一样的错误 → `disable`"之上**，
 * 痕迹表第 1 条也是「输入框里还没删的字，**第一幕开头起（00:17）**」——
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
 * ## 语言：**英文**
 *
 * 真界面在这台机器上是 zh locale（placeholder 是「描述你想要构建的内容…」，
 * 权限是「完全权限」）。但 §0 的硬约束是「**机器文本一律英文**」，
 * 而 §4.22 更狠：「**全片唯一的中文句子是人打的**（`你还好吗`）」——
 * 往输入框里放中国字，观众会以为那是**她**写的。
 * 所以这里的文案是英文，**全部集中在 `COMPOSER_TEXT` 一处**，要改只改那一处。
 */

/**
 * 输入框里的产品文案。**唯一一处**。
 *
 * ## 语言：`placeholder` 中文、`permission` 英文 —— 这是按新版规格来的，有出处
 *
 * `design-options.md`（2026-10-01 重构版）§1.1 的语言分工是：
 * **dsh 的 UI 文案是中文**（`深度求索中` / `工具已更新` / `思考`）；**模型产出的内容是英文**；
 * **人的文字是中文**。§2.3 还专门纠正了旧口径：
 * 「（**不是**"全片唯一的中文句子是人打的"——dsh 的 UI 文案本来就是中文）」
 * → 所以 `placeholder` 用**真界面实测到的那串中文**，不再是我按旧口径译的英文。
 *
 * ⚠️ 但 `permission` 是**例外**：§2.2 与 §3 把它当作**必须真实的 dsh 字符串**引用
 * （🎯「两个权限词配成一对：`Full access`（她开的门）／`403`（他关的窗）」，
 * §2.4 又说「`Full access` 是崩坏的语义前提」）。真界面在这台机器上显示的是「完全权限」，
 * 两处**不一致** —— 我按"被当成语义对的那一个"取 `Full access`，并**已报给作者**。
 * 要改成「完全权限」就改这一行（`film/test/pages.test.js` 里没有对着它写死断言）。
 */
export const COMPOSER_TEXT = {
  placeholder: '描述你想要构建的内容, / 调用指令, @ 文件或对话',
  permission: 'Full access',
  model: 'DeepSeek-V41-Flash High',
  add: '+',
  send: '↑',
};

/**
 * 输入框的 DOM。
 *
 * 结构照实测那一棵；**不加 `uV2eYG_hero`** —— 我们的会话是有内容的（不是空会话的首屏），
 * 那个类会把输入区 min-height 从 36 顶到 52、placeholder 变成居中两行。
 * @param {{text?: typeof COMPOSER_TEXT}} [o]
 * @returns {string}
 */
export function composerHtml(o = {}) {
  const t = o.text ?? COMPOSER_TEXT;
  return `
<div class="uV2eYG_root" data-dsh-composer="true">
  <div class="uV2eYG_card" data-composer-card="true">
    <div class="uV2eYG_overlayAnchor"></div>
    <div class="uV2eYG_scroll" data-input-scroll="true">
      <div class="uV2eYG_grow">
        <div class="uV2eYG_input" data-composer-input="true"></div>
        <div class="uV2eYG_placeholder" data-composer-placeholder="true">${esc(t.placeholder)}</div>
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
