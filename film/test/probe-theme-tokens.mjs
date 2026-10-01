import { readFileSync } from 'node:fs';

const NM = 'E:/NodeJSGlobalPackage/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const src = readFileSync(`${NM}/dsh-client-ui-theme/lib/client.js`, 'utf8');
const RE = /(?:const css(?:\$\d+)?|var \w+_css_default) = ("(?:[^"\\]|\\.)*");/g;
/** @type {string[]} */
const blocks = [];
for (const m of src.matchAll(RE)) {
  try {
    blocks.push(JSON.parse(m[1]));
  } catch {
    /* 忽略 */
  }
}
console.log(`主题包的 CSS 块数 ${blocks.length}`);
console.log(`含 data-ds-dark-theme 的块 ${blocks.filter((b) => b.includes('data-ds-dark-theme')).length}`);

// 找**基础层**（定义 --dsw-static-* 原始色值的那一块）与深色覆盖块
const baseBlock = blocks.find((b) => /--dsw-static-neutral-bluish-00\s*:/.test(b));
const darkAlias = blocks.find((b) => b.includes('data-ds-dark-theme') && b.includes('--dsw-alias-bg-base'));

console.log('=== 基础层（原始色值）===');
if (baseBlock) {
  for (const t of [
    '--dsw-static-neutral-bluish-00',
    '--dsw-static-neutral-bluish-1000',
    '--dsw-static-deepseek-500',
    '--dsw-static-red-600',
  ]) {
    const m = new RegExp(`${t}\\s*:\\s*([^;}]+)`).exec(baseBlock);
    console.log(`  ${t.padEnd(36)} ${m ? m[1] : '(没找到)'}`);
  }
  const nStatic = new Set([...baseBlock.matchAll(/(--dsw-static-[a-z0-9-]+)\s*:/g)].map((m) => m[1])).size;
  console.log(`  基础层里 --dsw-static-* 共 ${nStatic} 个`);
} else {
  console.log('  没找到基础层');
}

console.log('\n=== 深色覆盖层（alias 层，182 个令牌）===');
if (darkAlias) {
  for (const t of ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-border-l2']) {
    const m = new RegExp(`${t}\\s*:\\s*([^;}]+)`).exec(darkAlias);
    console.log(`  ${t.padEnd(36)} ${m ? m[1] : '(没找到)'}`);
  }
  const sel = darkAlias.slice(0, darkAlias.indexOf('{')).trim();
  console.log(`  选择器：${sel.slice(0, 100)}`);
}
