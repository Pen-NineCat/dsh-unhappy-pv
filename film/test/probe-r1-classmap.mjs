/**
 * film/test/probe-r1-classmap.mjs — R1 的真实工作量：**结构依赖**有多少。
 *
 * 三个问题（决定 R1 是"抄 9 份类名"还是"抄 100 份结构"）：
 *   1. 631 条规则的选择器平均点名几个类？（= 每块 DOM 要摆对几层）
 *   2. 有多少规则靠 `data-*` 属性选中？（R1 得同时抄对属性）
 *   3. 后缀选择器（`.a .b`）占比多少？（= 不能孤立地"贴一个类名"）
 */

import { readFileSync } from 'node:fs';

const CSS = 'film/vendor/dsh-web-frontend/assets/index-DUvMhLle.css';
const css = readFileSync(CSS, 'utf8');

/** @type {{selector: string, body: string}[]} */
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim();
  if (!selector || selector.startsWith('@')) continue;
  rules.push({ selector, body: m[2] });
}

/** 把一个选择器组拆成单个选择器 */
const splitSel = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

let total = 0;
let withClass = 0;
let withAttr = 0;
let withDescendant = 0;
let withChild = 0;
let classCount = 0;
let attrCount = 0;
/** @type {Map<string, number>} */
const attrNames = new Map();
/** @type {Map<number, number>} */
const classHist = new Map();

for (const r of rules) {
  for (const sel of splitSel(r.selector)) {
    total++;
    const classes = [...sel.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[(data-[a-z0-9-]+)/g)].map((m) => m[1]);
    if (classes.length) withClass++;
    if (attrs.length) {
      withAttr++;
      for (const a of attrs) attrNames.set(a, (attrNames.get(a) ?? 0) + 1);
    }
    if (classes.length > 1) withDescendant++;
    if (sel.includes('>')) withChild++;
    classCount += classes.length;
    attrCount += attrs.length;
    classHist.set(classes.length, (classHist.get(classes.length) ?? 0) + 1);
  }
}

console.log(`CSS 规则数（扁平解析）              ${rules.length}`);
console.log(`选择器实例数（逗号拆开后）          ${total}`);
console.log('');
console.log(`含类名的选择器                      ${withClass}（${((withClass / total) * 100).toFixed(0)}%）`);
console.log(`含 data-* 属性的选择器              ${withAttr}（${((withAttr / total) * 100).toFixed(0)}%）  ← 这些 R1 也得抄对`);
console.log(`点名 ≥2 个类的选择器（结构依赖）     ${withDescendant}（${((withDescendant / total) * 100).toFixed(0)}%）`);
console.log(`使用子选择器 > 的                  ${withChild}`);
console.log('');
console.log(`平均每个选择器点名 ${(classCount / total).toFixed(2)} 个类、${(attrCount / total).toFixed(2)} 个 data-*`);
console.log('按「点名几个类」分布（0..6）：');
for (let i = 0; i <= 6; i++) {
  const n = classHist.get(i) ?? 0;
  console.log(`  ${i} 个类：${String(n).padStart(4)}  ${'█'.repeat(Math.round((n / total) * 60))}`);
}
console.log('');
console.log('按 data-* 属性名统计（R1 必须一并复现的属性）：');
for (const [a, n] of [...attrNames.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20)) {
  console.log(`  ${a.padEnd(34)} ×${n}`);
}
