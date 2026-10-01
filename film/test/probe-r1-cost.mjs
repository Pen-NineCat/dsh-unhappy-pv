/**
 * film/test/probe-r1-cost.mjs — **R1 的复杂度量化**（测量，不是估计）。
 *
 * 要回答的问题：光有 vendored CSS + 自己搭 DOM，能不能把 dsh 的界面搭出来？
 * 关键不是「有多少类名」，而是：
 *   1. 类名分成多少个**组件块**（每个块要自己猜一份 DOM 结构）
 *   2. 有多少条规则**只靠未定义的令牌**取色（那样 CSS 生效了也没颜色）
 *   3. 一个规则平均几条声明（= 猜错结构时的破坏面）
 *
 * 用法：node film/test/probe-r1-cost.mjs [--real out/r2/boot.html]
 */

import { readFileSync, existsSync } from 'node:fs';

const CSS = 'film/vendor/dsh-web-frontend/assets/index-DUvMhLle.css';
const css = readFileSync(CSS, 'utf8');

// ── 1. 拆成规则（够用的解析器：只处理「选择器 { 声明 }」，忽略 @ 块内部也算进去）────
/** @type {{selector: string, body: string, index: number}[]} */
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim();
  const body = m[2];
  if (!selector || selector.startsWith('@')) continue;
  rules.push({ selector, body, index: m.index ?? 0 });
}
console.log(`CSS 规则总数（扁平解析）           ${rules.length}`);

// ── 2. hash 类名与「组件块」──────────────────────────────────────────────
// CSS-modules 的形态是 `_name_hash_N`，其中 `hash` 是同一模块共用的短哈希
const hashClasses = new Set();
for (const m of css.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
  const cls = m[1];
  if (/^[_a-zA-Z]/.test(cls) && /_[a-z0-9]{5}_\d+$/.test(cls)) hashClasses.add(cls);
}
const blocks = new Map();
for (const cls of hashClasses) {
  const m = /_(.{5})_\d+$/.exec(cls);
  const key = m ? m[1] : '(无)';
  if (!blocks.has(key)) blocks.set(key, []);
  blocks.get(key).push(cls);
}
console.log(`hash 类名总数                      ${hashClasses.size}`);
console.log(`不同的「组件块」数（每个块 = 一个模块）  ${blocks.size}`);
const sizes = [...blocks.values()].map((v) => v.length).sort((a, b) => b - a);
console.log(`每个块的类名数：最大 ${sizes[0]}、中位 ${sizes[Math.floor(sizes.length / 2)]}、只含 1 个的有 ${sizes.filter((s) => s === 1).length} 个`);

// ── 3. 取色依赖：有多少规则只靠 var(--dsw-*)（而那些令牌没在 vendored CSS 里定义）──
const definedTokens = new Set();
for (const m of css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) definedTokens.add(m[1]);
/** @type {Map<string, number>} */
const usedTokens = new Map();
let rulesWithVar = 0;
let rulesWithOnlyVarColors = 0;
for (const r of rules) {
  const vars = [...r.body.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((x) => x[1]);
  if (vars.length === 0) continue;
  rulesWithVar++;
  for (const v of vars) usedTokens.set(v, (usedTokens.get(v) ?? 0) + 1);
  // 「只靠令牌取色」= 这条规则里有 var(--dsw-*)，且没有任何硬编码颜色
  const hasHardcodedColor = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(r.body);
  if (!hasHardcodedColor) rulesWithOnlyVarColors++;
}
console.log('');
console.log(`vendored CSS 里**定义**的 --dsw-* 令牌   ${definedTokens.size}`);
console.log(`被**引用**的不同 --dsw-* 令牌             ${usedTokens.size}`);
console.log(`引用了 var(--dsw-*) 的规则数              ${rulesWithVar} / ${rules.length}（${((rulesWithVar / rules.length) * 100).toFixed(0)}%）`);
console.log(`其中**完全没有硬编码颜色**的规则数        ${rulesWithOnlyVarColors}（${((rulesWithOnlyVarColors / rules.length) * 100).toFixed(0)}% 的规则）`);
const topMissing = [...usedTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('被引用最多的令牌（前 8，全都没定义）：');
for (const [t, n] of topMissing) console.log(`  ${t.padEnd(38)} ×${n}${definedTokens.has(t) ? '  （已定义）' : ''}`);

// ── 4. 规则复杂度 ────────────────────────────────────────────────────────
let declTotal = 0;
let maxDecl = 0;
let maxSel = '';
for (const r of rules) {
  const n = r.body.split(';').filter((d) => d.trim()).length;
  declTotal += n;
  if (n > maxDecl) {
    maxDecl = n;
    maxSel = r.selector;
  }
}
console.log('');
console.log(`每条规则平均声明数                 ${(declTotal / rules.length).toFixed(1)}`);
console.log(`单条规则最多声明数                 ${maxDecl}（${maxSel.slice(0, 60)}…）`);

// ── 5. 如果拿到真 GUI 的 HTML：真实用到几个类名/多深的 DOM ─────────────────
const realHtml = process.argv.includes('--real') ? process.argv[process.argv.indexOf('--real') + 1] : null;
if (realHtml && existsSync(realHtml)) {
  const html = readFileSync(realHtml, 'utf8');
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  }
  const usedHash = [...used].filter((c) => /_[a-z0-9]{5}_\d+$/.test(c));
  const usedBlocks = new Set(usedHash.map((c) => (/_(.{5})_\d+$/.exec(c) ?? [])[1]));
  console.log('');
  console.log(`真首页 HTML 里 class 属性值总数      ${[...html.matchAll(/class="/g)].length}`);
  console.log(`  其中 hash 类名（去重）             ${new Set(usedHash).size}`);
  console.log(`  涉及的组件块                        ${usedBlocks.size}`);
  console.log(`  （对比：vendored CSS 一共有 ${hashClasses.size} 个类名 / ${blocks.size} 个块）`);
}
