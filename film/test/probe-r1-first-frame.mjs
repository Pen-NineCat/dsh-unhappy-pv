#!/usr/bin/env node
/**
 * film/test/probe-r1-first-frame.mjs — **R1 的第一帧**（Phase 5 / R1 的最终判据）。
 *
 * 目的只有一个：用**真 dsh 的 CSS**（`film/vendor/dsh-css/dsh.css`，从 vendored 包里抽出来的）
 * 渲出一张静态页，看样式到底吃不吃得上 —— 也就是当初 T1 要回答的那个问题，
 * 但这次不需要 dsh 服务在场（R1 的全部意义）。
 *
 * 判据（与 `design-options.md` §1.11 的五条验收对齐）：
 *   字体  = Segoe UI / Microsoft YaHei（vendored CSS 的系统栈）
 *   布局  = 有 dsh 的容器结构（圆角/边框/内边距）
 *   颜色  = **dsh 的色板**（不是纯黑纯白）← 这条以前必失败，因为令牌缺 90 个
 *   贴图  = 1:1
 *   确定性 = 同一 `n` 两次一致
 *
 * 用法：node film/test/probe-r1-first-frame.mjs [--light]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertThemeAssets, themeHead, themeScript } from '../pages/dsh-theme.js';
import { column, disclosureRow, fixedHeader, text, toolDetails, userBubble } from '../pages/dsh-blocks.js';
import { serveStatic } from '../lib/static-server.js';

const OUT = 'out/r1';
const W = 960;
const H = 640;

/** 引子的 context 文档（`design-options.md` §1.5 里那份真实措辞）。 */
const CONTEXT_LINES = [
  '<system-reminder>',
  'The following workspace instructions may be relevant to your work. Use them as guidance',
  'when applicable. More specific instructions take precedence over broader ones. They do not',
  'override system, developer, or direct user instructions.',
  '',
  'Instructions from: ~/.dsh/AGENTS.md',
  '',
  '<user-global-instructions>',
  '',
  'Instructions from: AGENTS.md',
  '',
  '<project-instructions>',
];

function main() {
  const light = process.argv.includes('--light');
  const theme = /** @type {'dark'|'light'} */ (light ? 'light' : 'dark');
  assertThemeAssets();
  console.log('四份样式齐备 ✅');

  const body = column([
    fixedHeader({}),
    disclosureRow({
      title: 'context',
      summary: 'AGENTS.md · 3 条工作区指令',
      expanded: true,
      // ⚠️ 这里**用 ContextBody 的正文类**（`text()`），不是工具详情列表：
      //    `DXqwVW_*` 是 ToolDetails（工具调用的详情），名字看起来像代码块，
      //    实测核对过抽出的 CSS 才改过来的（见 film/pages/dsh-blocks.js 的说明）。
      body: CONTEXT_LINES.map((l) => (l === '' ? '' : text(l))).join('\n'),
    }),
    text('（以下为滚动区内容，正式版本由 body.js 按 t 驱动 —— 见 film/pages/intro.js）'),
    // 布局判据的证据：一个**有边框/圆角/底色**的 dsh 容器。
    // ⚠️ 这是 `DXqwVW_*` = **工具详情**（ToolDetails），不是 markdown 代码块 ——
    //    名字容易认错，实测核对过抽出的 CSS 才写对（见 dsh-blocks.js）。
    toolDetails({ lines: ['tool: read_file  ✓', 'tool: run  ✓'], caption: 'tool details（布局判据）' }),
    userBubble({ text: '（这一帧只是 R1 的样式判据，不是引子的最终画面）' }),
  ]);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>R1 first frame</title>
${themeHead({ theme, basePath: '/vendor' })}
</head>
<body>
<div id="app">${body}</div>
${themeScript(theme)}
</body>
</html>
`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'first-frame.html'), html, 'utf8');
  console.log(`写出 ${OUT}/first-frame.html（${Buffer.byteLength(html)} 字节）`);
  return { html, theme };
}

// ── 如果带 --shot，就顺带用 Playwright 截一张并做五项判据 ─────────────────
const shot = process.argv.includes('--shot');

if (!shot) {
  main();
  process.exit(0);
}

const { theme } = main();

const srv = await serveStatic(OUT, { mounts: { '/vendor': 'film/vendor' } });
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${srv.url}first-frame.html`, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const root = document.getElementById('app');
  const cs = getComputedStyle(document.body);
  const probe = document.querySelector('.dsh-col');
  const pcs = probe ? getComputedStyle(probe) : null;
  const code = document.querySelector('.DXqwVW_root');
  const ccs = code ? getComputedStyle(code) : null;
  return {
    bodyBg: cs.backgroundColor,
    bodyColor: cs.color,
    bodyFont: cs.fontFamily,
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    elements: root.querySelectorAll('*').length,
    colWidth: pcs ? pcs.width : null,
    codeBg: ccs ? ccs.backgroundColor : null,
    codeBorder: ccs ? ccs.borderTopWidth + ' ' + ccs.borderTopColor : null,
    codeRadius: ccs ? ccs.borderTopLeftRadius : null,
    // 令牌是否真的解析出了值（这条以前必为空）
    // ⚠️ **必须读 `body`**：真界面（和 dsh.css）把令牌定义在 `body{}` / `body[data-ds-dark-theme]{}` 上，
    //    `documentElement`（`:root`）上**一个 `--dsw-*` 都没有**。读错元素会得到
    //    「令牌全是空」这种看起来像结论的假信息（2026-10-01 实测，见记录 23）。
    tokens: ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-markdown-code-block', '--dsw-radius-lg']
      .map((t) => `${t} = ${getComputedStyle(document.body).getPropertyValue(t).trim() || '(空)'}`),
    usedFont: (() => {
      const el = document.querySelector('.ZkiH0q_text');
      return el ? getComputedStyle(el).fontFamily : null;
    })(),
  };
});

console.log('\n=== 请求记录（看样式到底有没有加载）===');
for (const r of srv.requests) console.log(`  ${r.status}  ${r.url}`);
const bad = srv.requests.filter((r) => r.status !== 200);
console.log(bad.length ? `❌ ${bad.length} 个非 200` : '✅ 全部 200');

console.log('\n=== R1 第一帧 · 五项判据 ===');
console.log(JSON.stringify(info, null, 2));
if (errors.length) console.log('pageerror:', errors);

// ⭐ 确定性：同一页截两次
const { createHash } = await import('node:crypto');
const png1 = await page.screenshot({ type: 'png' });
const png2 = await page.screenshot({ type: 'png' });
const h1 = createHash('sha256').update(png1).digest('hex');
const h2 = createHash('sha256').update(png2).digest('hex');
writeFileSync(join(OUT, `first-frame-${theme}.png`), png1);
console.log(`\n截图 ${OUT}/first-frame-${theme}.png`);
console.log(`⭐ 同页两次：${h1 === h2 ? '一致 ✅' : '不一致 ❌'}  ${h1.slice(0, 16)}…`);

await browser.close();
await srv.close();
process.exit(0);
