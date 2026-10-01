/**
 * film/pages/dsh-theme.js — R1 的**页面头**：把真 dsh 的样式组装进一张静态页（Phase 5 / R1）。
 *
 * 它是 R1 与「自己写 CSS 假装像 dsh」之间那条线的落点：样式**全部来自 dsh**，
 * 我们只负责把它们按正确顺序拼起来、并把主题开关打开。
 *
 * ## 样式从哪来（四份，顺序有意义）
 *
 * | # | 来源 | 作用 |
 * |---|---|---|
 * | 1 | `film/vendor/dsh-web-frontend/assets/vendor-*.css` | 第三方/基础层（dsh 构建时的 vendor chunk） |
 * | 2 | `film/vendor/dsh-web-frontend/assets/index-*.css` | dsh 壳自己的 CSS-module（`hHd-Xa_root` 这类类名） |
 * | 3 | **`film/vendor/dsh-css/dsh.css`** | **从 dsh 客户端 UI 包抽出来的组件 CSS + 全套设计令牌**（R1 的关键，见 `film/vendor/README.md`） |
 * | 4 | `film/vendor/dsh-css/fallback-tokens.css` | **我们补的** 2 个兜底令牌（dsh 自己没定义），必须放最后才能覆盖 |
 *
 * ## 两个细节（都会静默出错，所以写清楚）
 *
 * 1. **文件名不能硬编码**：`index-DUvMhLle.css` 里的 hash 一升级就变
 *    （`AGENTS.md` §6 明确要求「扫 `assets/` 现取」）。所以这里扫目录。
 * 2. **深色靠 `body[data-ds-dark-theme]`**：实测（附录 E.3）主题包用
 *    `body[data-ds-dark-theme]{...}` 覆盖 182 个 alias 令牌；不在 `<body>` 上打这个属性
 *    就永远是浅色。**一个数值都不用改**。
 * 3. **`--dsh-content-font-size` 必须由我们设**（默认 14px）：真实 dsh 是在 bootstrap 脚本里
 *    `document.body.style.setProperty('--dsh-content-font-size', `${fontSize}px`)`，
 *    取值 12–17 的整数（用户偏好）。dsh.css 只**读**它（全带 `,14px` 兜底）并派生出
 *    `--dsh-content-font-delta` 等。静态页不设它也不会崩（兜底就是 14px），但那样
 *    R1 与 R2 的 computed style 就不在同一个基线上 —— 对拍会看到一堆假差异。
 * 4. **类名会漂，所以按「本地名」现取**：`_markdown_1ypvv_5` 这种 vite 作用域名里
 *    保留了源码的 localName，但 hash 与行号会随构建变。见 `shellClass()`。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const VENDOR = 'film/vendor';
const FRONTEND = join(VENDOR, 'dsh-web-frontend');
const EXTRACTED = join(VENDOR, 'dsh-css');

/**
 * 静态服务器要挂的目录（`shot.mjs` / `gen-frames.js` 都从这里取，不要各写一份）。
 * 页面里的样式表用 `/vendor/...` 引用它们 —— 全部本地，无 CDN（焊点 7）。
 */
export const VENDOR_MOUNT = { '/vendor': VENDOR };

/** 页面引用样式表时用的前缀。 */
export const VENDOR_BASE = '/vendor';

/** 真界面默认的正文字号（dsh 的用户偏好区间是 12–17）。 */
export const DEFAULT_CONTENT_FONT_SIZE = 14;


/**
 * 从**外壳 CSS**（`assets/index-*.css`）里按**本地名**取一个类名。
 *
 * 为什么需要它：`@deepseek-ai/dsh-client-ui-primitives`（MarkdownText / DisclosureRow /
 * CodeBlock / TextShimmer）**不在**抽出来的 `dsh-css/dsh.css` 里 —— 它被打进前端外壳，
 * 类名是 vite 的 `_<localName>_<hash>_<line>`（例如 `_markdown_1ypvv_5`）。
 * hash 与行号**随构建漂移**，`AGENTS.md` §6 已经因为同样原因要求「扫 `assets/` 现取」文件名；
 * 类名用同一个办法：**认 localName，不认 hash**。
 *
 * ⚠️ 本地名会重名（实测：`<localName>` 与 `markdown` 同名的类有两个 ——
 * `_markdown_1ypvv_5` 是 MarkdownText 的根，`_markdown_1wejo_28` 是别的东西）。
 * 所以**必须**给一个 `needle`：候选类名的**自身规则体**里要出现这段文字。
 * 重名不报错、随便挑一个，就会静默地拿到错的那块布 —— 这里宁可抛错。
 * @param {string} localName 源码里的 CSS-module 本地名（如 `markdown`）
 * @param {string} needle 该规则体里必须出现的字面片段（如 `font:var(--dsw-font-markdown-base)`）
 * @returns {{name: string, source: string, rule: string}} 完整类名、所在文件、命中的规则原文
 */
export function shellClass(localName, needle) {
  if (!needle) throw new Error(`shellClass("${localName}"): 必须给 needle（本地名会重名，见函数说明）`);
  const asset = findAsset('index', '.css');
  const file = join(FRONTEND, asset.replace('./assets/', 'assets/'));
  if (!existsSync(file)) throw new Error(`shellClass: 找不到 ${file}`);
  const css = readFileSync(file, 'utf8');

  // 1) 先按 vite 作用域名形状收集候选：._<local>_<hash>_<行号>
  const shape = new RegExp(`\\._${localName}_([A-Za-z0-9_-]+)_(\\d+)`, 'g');
  const candidates = new Set();
  for (const m of css.matchAll(shape)) candidates.add(`_${localName}_${m[1]}_${m[2]}`);
  if (candidates.size === 0) {
    throw new Error(
      `shellClass("${localName}"): ${asset} 里找不到 ._${localName}_<hash>_<行号> 形式的类名。\n` +
        `  hint: 前端升级可能改了本地名，或该模块不再被打进外壳；` +
        `先确认 dsh.css（插件包那份）里有没有 —— 两处的来源不同，见 film/vendor/README.md`,
    );
  }

  // 2) 用规则体把候选筛到唯一
  /** @type {{name: string, rule: string}[]} */
  const hits = [];
  for (const name of candidates) {
    for (const m of css.matchAll(new RegExp(`\\.${name}\\s*\\{([^{}]*)\\}`, 'g'))) {
      if (m[1].includes(needle)) hits.push({ name, rule: m.Value });
    }
  }
  if (hits.length !== 1) {
    throw new Error(
      `shellClass("${localName}", ${JSON.stringify(needle)}): 命中 ${hits.length} 条规则` +
        `${hits.length ? `（${hits.map((h) => h.name).join(', ')}）` : ''}。\n` +
        `  候选：${[...candidates].join(', ')}\n` +
        `  hint: 期望**恰好一条** —— 0 条说明这段文字不在这块布里（或前端升级改了它），\n` +
        `        多条说明 needle 挑得不够独特。**不要**改成「随便取第一个」。`,
    );
  }
  return { name: hits[0].name, source: asset, rule: hits[0].rule };
}

/**
 * `intro` 那一页要用的外壳类名。**一次解析、永久缓存**（配置，不是跨帧状态）。
 * @returns {{markdown: string, compact: string, source: string}}
 */
export function markdownRootClass() {
  const md = shellClass('markdown', 'font:var(--dsw-font-markdown-base)');
  const compact = shellClass('compact', 'font-size:var(--dsh-content-font-size-secondary');
  return { markdown: md.name, compact: compact.name, source: md.source };
}

/**
 * 扫 `assets/` 现取一个 hash 文件名（**不硬编码**）。
 * @param {'vendor'|'index'} base 文件名前缀
 * @param {'.css'|'.js'} ext
 * @returns {string} 相对路径（`./assets/xxx.css`），找不到时抛错并列出实际内容
 */
export function findAsset(base, ext) {
  const dir = join(FRONTEND, 'assets');
  if (!existsSync(dir)) {
    throw new Error(
      `找不到 ${dir} —— vendored 的 dsh 前端不在。\n` +
        `  hint: 见 film/vendor/README.md 的「怎么更新」`,
    );
  }
  const hit = readdirSync(dir).find((f) => f.startsWith(`${base}-`) && f.endsWith(ext));
  if (!hit) {
    throw new Error(
      `${dir} 里没有 ${base}-*${ext}\n  实际内容：${readdirSync(dir).join(', ')}\n` +
        `  hint: 升级过 dsh-web-frontend？见 film/vendor/README.md`,
    );
  }
  return `./assets/${hit}`;
}

/**
 * 组装页面的 `<head>` 里那几行 `<link>`/`<style>`。
 *
 * 返回的是**HTML 片段**（不是要写文件），由 `gen-frames.js` 塞进页面模板。
 * 全部用相对路径（相对 `out/gen/`），资源由 `shot.mjs` 的静态服务器提供。
 * @param {{theme?: 'dark'|'light', basePath?: string, inlineExtracted?: boolean}} [opts]
 *   `basePath`：页面相对于 `out/gen/` 的路径前缀（默认 `../../film/vendor/…` 那种由 mount 决定）
 * @returns {string} HTML
 */
export function themeHead(opts = {}) {
  const theme = opts.theme ?? 'dark';
  const base = opts.basePath ?? VENDOR_BASE;
  const frontendVendor = findAsset('vendor', '.css').replace('./assets/', `${base}/dsh-web-frontend/assets/`);
  const frontendIndex = findAsset('index', '.css').replace('./assets/', `${base}/dsh-web-frontend/assets/`);

  return [
    `<link rel="stylesheet" href="${frontendVendor}" />`,
    `<link rel="stylesheet" href="${frontendIndex}" />`,
    `<link rel="stylesheet" href="${base}/dsh-css/dsh.css" />`,
    `<link rel="stylesheet" href="${base}/dsh-css/fallback-tokens.css" />`,
    `<style>${baseCss(theme)}</style>`,
  ].join('\n');
}

/**
 * 我们**自己**加的那一点点 CSS（不是 dsh 的）。
 *
 * 克制原则：只做 dsh 不做、但**页面必需**的事 —— 目前只有三件：
 * 1. 把 `html/body` 的边距清零（dsh 的 CSS 假设它自己被一个 app 容器包着）
 * 2. 给 `body` 打 `data-ds-dark-theme`（深色开关，见文件头）
 * 3. 一个居中的内容列（dsh 真界面有侧栏+主区两列；我们只截主区那一块）
 *
 * **不要**在这里"顺手美化" —— 一旦开始写颜色/圆角/间距，就不再是 dsh 的样子了。
 * @param {'dark'|'light'} theme
 * @returns {string}
 */
function baseCss(theme) {
  return `
/* 由 film/pages/dsh-theme.js 生成 —— 只做 dsh 没做、而页面必需的事 */
html, body { margin: 0; padding: 0; }
/* --dsh-content-font-size：真实 dsh 由 bootstrap 脚本写在 body 的内联样式上（见文件头第 3 条）。
   不设也能跑（dsh 的 var() 都带 ,14px 兜底），但设了才与真界面同基线。 */
body { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #0f1115); --dsh-content-font-size: ${DEFAULT_CONTENT_FONT_SIZE}px; }
* { box-sizing: border-box; }
#app { width: 100%; min-height: 100vh; }
${theme === 'light' ? '' : '/* 深色：靠 HTML 上的 body[data-ds-dark-theme]，见文件头 */'}
`.trim();
}

/**
 * 深色开关：往 `<body>` 上打 `data-ds-dark-theme`。
 *
 * 这是 R1 里唯一必要的 JS —— 因为我们不跑 dsh 的 React，没有东西替我们打这个属性。
 * @param {'dark'|'light'} theme
 * @returns {string} 一段可内联的 script
 */
export function themeScript(theme) {
  if (theme === 'light') return '';
  return `<script>document.body.setAttribute('data-ds-dark-theme','');</script>`;
}

/**
 * 自检：四份样式在不在。`gen-frames.js` 生成前调一次，**早失败**。
 * @returns {{ok: true, files: string[]} | never}
 */
export function assertThemeAssets() {
  /** @type {string[]} */
  const files = [];
  for (const [base, ext] of [
    ['vendor', '.css'],
    ['index', '.css'],
  ]) {
    files.push(findAsset(/** @type {any} */ (base), /** @type {any} */ (ext)));
  }
  for (const f of ['dsh.css', 'fallback-tokens.css']) {
    const p = join(EXTRACTED, f);
    if (!existsSync(p)) {
      throw new Error(
        `缺少 ${p} —— R1 的样式快照不在。\n` +
          `  hint: node film/pages/extract-css.mjs（它会从 film/vendor/ 的包抽出来）`,
      );
    }
    files.push(p);
  }
  return { ok: true, files };
}
