/**
 * film/test/probe-css-extract.mjs — 验证参考仓库那条路：**能不能从 client bundle 里抽出真 CSS（含令牌）**。
 *
 * 参考仓库 `film/vendor/` 里除了 `dsh-web-frontend` 还 vendor 了 `dsh-client-ui-cordis`，
 * 并用 `extract_css.py` 从 `lib/client.js` 里正则抽 CSS 字符串，包列表里第一个就是
 * **`dsh-client-ui-theme`（"theme tokens included"）** —— 也就是我们缺的那 91 个令牌。
 *
 * 这个探针做的事：对**本机已装的 dsh** 跑同一套抽取，看能不能拿到该包该给的 CSS。
 *
 * 用法：node film/test/probe-css-extract.mjs [--list]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NM = 'E:\\NodeJSGlobalPackage\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai';

/** 参考仓库用的正则（原样搬来，先验证它在新版本上还成立） */
const CSS_RE = /(?:const css(?:\$\d+)?|var \w+_css_default) = ("(?:[^"\\]|\\.)*");/g;

/**
 * 从包的 client bundle 里抽 CSS 字符串。
 * @param {string} name 包名（@deepseek-ai/ 之后的部分）
 * @returns {{name: string, blocks: string[], tokens: number, bytes: number}|null}
 */
function packageCss(name) {
  const p = join(NM, name, 'lib', 'client.js');
  if (!existsSync(p)) return null;
  const src = readFileSync(p, 'utf8');
  /** @type {string[]} */
  const blocks = [];
  for (const m of src.matchAll(CSS_RE)) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      /* 不是合法 JSON 字符串就跳过 */
    }
  }
  const all = blocks.join('\n');
  const tokens = new Set([...all.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  return { name, blocks, tokens: tokens.size, bytes: all.length, tokenNames: [...tokens] };
}

// 参考仓库的那份包列表
const REF_PACKAGES = [
  'dsh-client-ui-theme',
  'dsh-client-ui-chat',
  'dsh-client-ui-tool',
  'dsh-client-ui-conversation',
  'dsh-client-ui-message-feedback',
  'dsh-client-ui-deliverables',
  'dsh-client-ui-layout',
];

const listMode = process.argv.includes('--list');

if (listMode) {
  console.log('=== 本机 dsh 里所有 dsh-client-ui-* 包（看有多少个可 vendor 的）===');
  const all = readdirSync(NM).filter((n) => n.startsWith('dsh-client-ui-'));
  console.log(`共 ${all.length} 个：`);
  for (const n of all) {
    const p = join(NM, n, 'lib', 'client.js');
    const size = existsSync(p) ? statSync(p).size : 0;
    console.log(`  ${n.padEnd(46)} client.js ${size ? (size / 1024).toFixed(0) + ' KB' : '(无)'}`);
  }
  process.exit(0);
}

console.log('── 从 client bundle 抽 CSS（参考仓库的路子）────────────────');
console.log(`包目录 ${NM}\n`);

/** @type {Map<string, string[]>} */
const allTokenNames = new Map();
let totalBlocks = 0;
let totalBytes = 0;

for (const name of REF_PACKAGES) {
  const r = packageCss(name);
  if (!r) {
    console.log(`  ${name.padEnd(38)} ❌ 没装 / 没有 lib/client.js`);
    continue;
  }
  totalBlocks += r.blocks.length;
  totalBytes += r.bytes;
  for (const t of r.tokenNames) allTokenNames.set(t, [...(allTokenNames.get(t) ?? []), name]);
  console.log(
    `  ${name.padEnd(38)} ✅ ${String(r.blocks.length).padStart(3)} 块 CSS · ` +
      `${(r.bytes / 1024).toFixed(0).padStart(4)} KB · 定义 ${String(r.tokens).padStart(3)} 个 --dsw-*`,
  );
}

console.log('');
console.log(`合计：${totalBlocks} 块 CSS，${(totalBytes / 1024).toFixed(0)} KB，` +
  `覆盖 ${allTokenNames.size} 个不同的 --dsw-* 令牌`);
console.log('');

// 最关键的检查：我们缺的那 91 个令牌，有多少能在这里找到？
const VENDORED_CSS = 'film/vendor/dsh-web-frontend/assets/index-DUvMhLle.css';
const vendored = readFileSync(VENDORED_CSS, 'utf8');
const referenced = new Set([...vendored.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]));
const definedHere = new Set([...vendored.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const missing = [...referenced].filter((t) => !definedHere.has(t));
const recovered = missing.filter((t) => allTokenNames.has(t));
const stillMissing = missing.filter((t) => !allTokenNames.has(t));

console.log(`vendored CSS 引用了 ${referenced.size} 个令牌，自己定义了 ${definedHere.size} 个 → 缺 ${missing.length} 个`);
console.log(`  ✅ 能从上列 client bundle 里补回：${recovered.length} / ${missing.length}（${((recovered.length / missing.length) * 100).toFixed(0)}%）`);
console.log(`  ❌ 仍然缺：${stillMissing.length}`);
if (stillMissing.length) {
  console.log(`     前 12 个：${stillMissing.slice(0, 12).join(', ')}`);
  console.log('     （这些很可能在别的 UI 包里 —— 用 --list 看清单，把它们加进包列表）');
}
if (recovered.length) {
  console.log(`\n  抽样补回的令牌（前 10）：`);
  for (const t of recovered.slice(0, 10)) console.log(`    ${t.padEnd(40)} ← ${allTokenNames.get(t)?.join(', ')}`);
}
