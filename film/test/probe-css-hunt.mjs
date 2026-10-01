/**
 * film/test/probe-css-hunt.mjs — 把「缺的那几个令牌」在**所有已装包**里找出来，并给出 vendor 体积。
 *
 * 上一轮结论：从 7 个 UI 包里能补回 88/90 个缺失令牌。
 * 这个探针回答最后两问：
 *   1. 剩下那几个散在哪个包？（顺带：全 UI 一共要 vendor 多少个包、多大）
 *   2. `@layer` / `@font-face` 这类东西会不会在提取时丢掉（影响保真）
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NM = 'E:\\NodeJSGlobalPackage\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai';
const CSS_RE = /(?:const css(?:\$\d+)?|var \w+_css_default) = ("(?:[^"\\]|\\.)*");/g;

/**
 * @param {string} name
 * @returns {{blocks: string[], css: string, bytes: number}|null}
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
      /* 忽略 */
    }
  }
  const css = blocks.join('\n');
  return { blocks, css, bytes: css.length };
}

// 目标：vendored CSS 引用但没定义的令牌
const vendored = readFileSync('film/vendor/dsh-web-frontend/assets/index-DUvMhLle.css', 'utf8');
const referenced = new Set([...vendored.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]));
const defined = new Set([...vendored.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const missing = [...referenced].filter((t) => !defined.has(t));

console.log(`要找的令牌：${missing.length} 个\n`);

const packages = readdirSync(NM).filter((n) => n.startsWith('dsh-'));
/** @type {{name: string, tokens: Set<string>, bytes: number, blocks: number, clientBytes: number}[]} */
const found = [];
for (const name of packages) {
  const r = packageCss(name);
  if (!r) continue;
  const tokens = new Set([...r.css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  if (tokens.size === 0) continue;
  const clientBytes = statSync(join(NM, name, 'lib', 'client.js')).size;
  found.push({ name, tokens, bytes: r.bytes, blocks: r.blocks.length, clientBytes });
}
found.sort((a, b) => b.tokens.size - a.tokens.size);

console.log('=== 定义了 --dsw-* 令牌的所有包 ===');
let cum = 0;
let cumClient = 0;
const covered = new Set();
for (const f of found) {
  const newOnes = [...f.tokens].filter((t) => missing.includes(t) && !covered.has(t));
  for (const t of newOnes) covered.add(t);
  cum += f.bytes;
  cumClient += f.clientBytes;
  console.log(
    `  ${f.name.padEnd(38)} 令牌 ${String(f.tokens.size).padStart(3)}  CSS ${(f.bytes / 1024).toFixed(0).padStart(3)} KB  ` +
      `client.js ${(f.clientBytes / 1024).toFixed(0).padStart(4)} KB  新增覆盖我们缺的 ${String(newOnes.length).padStart(2)} 个`,
  );
}
console.log('');
console.log(`累计：CSS ${(cum / 1024).toFixed(0)} KB；若要 vendor 这些包的 client.js 则是 ${(cumClient / 1024 / 1024).toFixed(1)} MB`);
console.log(`缺的 ${missing.length} 个令牌里，被覆盖 ${covered.size} 个，仍缺 ${missing.length - covered.size} 个`);
const rest = missing.filter((t) => !covered.has(t));
if (rest.length) console.log(`  仍缺：${rest.join(', ')}`);

// ── 提取保真：@layer / @font-face / 注释 会不会丢 ─────────────────────────
console.log('\n=== 提取保真检查（主题包）===');
const theme = packageCss('dsh-client-ui-theme');
if (theme) {
  for (const needle of ['@layer', '@font-face', '@media', 'prefers-color-scheme', 'data-ds-dark-theme', 'color-scheme']) {
    const n = theme.css.split(needle).length - 1;
    console.log(`  ${needle.padEnd(22)} ${n} 次`);
  }
  // 深浅两套令牌各有多少
  const darkBlocks = theme.blocks.filter((b) => b.includes('data-ds-dark-theme') || b.includes('prefers-color-scheme'));
  console.log(`  含深色选择器的 CSS 块：${darkBlocks.length} / ${theme.blocks.length}`);
}

// ── 其他 UI 包（不带令牌但带组件 CSS）的体积 ───────────────────────────
console.log('\n=== 只带组件 CSS（不含令牌）的 UI 包，按体积排序（前 15）===');
const compOnly = [];
for (const name of packages) {
  if (!name.startsWith('dsh-client-ui-')) continue;
  const r = packageCss(name);
  if (!r || r.bytes === 0) continue;
  const tokens = [...r.css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].length;
  if (tokens > 0) continue;
  compOnly.push({ name, bytes: r.bytes, blocks: r.blocks.length });
}
compOnly.sort((a, b) => b.bytes - a.bytes);
let compTotal = 0;
for (const c of compOnly) compTotal += c.bytes;
for (const c of compOnly.slice(0, 15)) {
  console.log(`  ${c.name.padEnd(46)} ${String(c.blocks).padStart(3)} 块  ${(c.bytes / 1024).toFixed(0).padStart(4)} KB`);
}
console.log(`  …共 ${compOnly.length} 个这样的包，CSS 合计 ${(compTotal / 1024).toFixed(0)} KB`);
