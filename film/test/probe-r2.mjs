/**
 * film/test/probe-r2.mjs — **R2 探针**：真 `dsh web` 能不能当素材源。
 *
 * 回答三个问题（这是 R2 可行性的全部）：
 * 1. 能不能起一个**独立**的 dsh web（不碰已经在跑的 GUI）？
 * 2. 能不能通过它的 token 围栏（第一次直接抓首页是 **401**）？
 * 3. 抓到的页面**真的渲染出 dsh 界面了吗**（还是又一个错误卡片）？
 *
 * 用法：node film/test/probe-r2.mjs [--port 0] [--out out/r2]
 *       node film/test/probe-r2.mjs --width 960 --height 640 --dpr 2   # 当 R1 的基准截图
 *       node film/test/probe-r2.mjs --skip-cross                        # 跳过跨实例复现（省两次 boot）
 *
 * ⚠️ 截图侧 `--width/--height/--dpr` 是后加的：R1 的手搭页面是 960×640 @dpr2，
 * 「并排比」必须在**同一个视口与同一个 dpr** 下取，否则字号/行高的比较没有意义。
 *
 * 启动协议与「停住页面」的实现已抽到 `film/lib/dsh-web.js`（R2 的启动只留一份实现）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LAUNCH_ARGS, bootDshWeb, openPinnedGui, pinAnimations } from '../lib/dsh-web.js';

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ name, /** @type {any} */ dflt) => {
  const i = argv.indexOf(name);
  return i < 0 ? dflt : argv[i + 1];
};
const PORT = Number(flag('--port', 0)) || 0;
const OUT = String(flag('--out', 'out/r2'));
const VIEW = {
  width: Number(flag('--width', 1440)) || 1440,
  height: Number(flag('--height', 900)) || 900,
  deviceScaleFactor: Number(flag('--dpr', 2)) || 2,
  settleMs: Number(flag('--settle-ms', 4000)) || 4000,
};
const SKIP_CROSS = argv.includes('--skip-cross');

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('── R2 探针：真 dsh web 当素材源 ──────────────────────────');

  console.log(`[1/6] 起一个独立的 dsh web（--port ${PORT || 0} → OS 选端口）`);
  const boot = await bootDshWeb({ port: PORT });
  console.log(`      ✅ 端口 ${boot.port}`);
  console.log(`      token ${boot.token.slice(0, 12)}…（${boot.token.length} 字符）`);
  console.log('      启动输出：');
  for (const l of boot.lines.slice(0, 8)) console.log(`        ${l}`);

  try {
    console.log('\n[2/6] 无 token 抓首页（预期 401）');
    const noToken = await fetch(`http://127.0.0.1:${boot.port}/`).catch((e) => ({ status: `fetch 失败：${e.message}` }));
    console.log(`      → ${noToken.status}`);

    console.log('\n[3/6] 带 token 抓首页，数一数启动协议的关键片段');
    const withToken = await fetch(boot.url);
    const html = await withToken.text();
    console.log(`      → HTTP ${withToken.status}，${html.length} 字节`);
    for (const needle of ['__ModuleLoader__', '__DSH_BOOT__', 'script-preload', 'script-src', 'data-dsh']) {
      const n = html.split(needle).length - 1;
      console.log(`        ${needle.padEnd(20)} ${n} 次`);
    }
    writeFileSync(join(OUT, 'boot.html'), html, 'utf8');
    console.log(`      首页已存 ${OUT}/boot.html`);

    console.log('\n[4/6] Playwright 打开真界面（固定 viewport / dpr，等字体，停动画）');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    console.log(`      视口 ${VIEW.width}×${VIEW.height} @dpr${VIEW.deviceScaleFactor}`);
    const { page, errors } = await openPinnedGui(browser, boot, VIEW);

    const info = await page.evaluate(() => {
      const root = document.getElementById('root');
      const all = [...document.querySelectorAll('*')];
      const cs = root ? getComputedStyle(root) : null;
      const bodyCs = getComputedStyle(document.body);
      return {
        title: document.title,
        rootChildren: root ? root.children.length : -1,
        rootHtmlLength: root ? root.innerHTML.length : -1,
        elementCount: all.length,
        maxDepth: (function depth(el, d) {
          let m = d;
          for (const c of el.children) m = Math.max(m, depth(c, d + 1));
          return m;
        })(document.body, 0),
        bodyBg: bodyCs.backgroundColor,
        bodyColor: bodyCs.color,
        bodyFont: bodyCs.fontFamily,
        rootDisplay: cs?.display,
        classes: [...new Set(all.flatMap((e) => [...e.classList]))].slice(0, 30),
        // 关键：设计令牌有没有被注入
        tokens: ['--dsw-alias-bg-base', '--dsw-alias-text-primary', '--dsw-static-deepseek-500'].map(
          (t) => `${t}=${getComputedStyle(document.documentElement).getPropertyValue(t).trim() || '(空)'}`,
        ),
        fontsReady: document.fonts.status,
        animationCount: document.getAnimations().length,
        // 有没有「空状态」提示（能看出这个 GUI 是不是真在服务）
        bodyTextHead: (document.body.innerText || '').slice(0, 400),
      };
    });
    console.log('      页面状态：');
    console.log(JSON.stringify(info, null, 2).split('\n').map((l) => `      ${l}`).join('\n'));
    if (errors.length) {
      console.log('      错误：');
      for (const e of errors.slice(0, 10)) console.log(`        ${e}`);
    }

    const shot = join(OUT, 'real-gui.png');
    await page.screenshot({ path: shot });
    console.log(`\n[5/6] 截图 ${shot}`);

    // ── 决定性一问：真 GUI 的同一屏，截两次是不是一样？ ──────────
    // 这是七个焊点的总验收在 R2 下的版本。真 GUI 有 WebSocket、时钟、
    // 会话状态，**它不保证确定** —— 所以必须实测，不能假设。
    const { createHash } = await import('node:crypto');
    /** @type {string[]} */
    const hashes = [];
    for (let i = 0; i < 3; i++) {
      // 每轮都重做一遍「停动画 + 等字体」
      await pinAnimations(page);
      await page.evaluate(() => document.fonts.ready);
      const buf = await page.screenshot({ type: 'png' });
      hashes.push(createHash('sha256').update(buf).digest('hex'));
      await page.waitForTimeout(600); // 故意等一会儿，让"会自己动的东西"有机会暴露出来
    }
    const distinct = new Set(hashes).size;
    console.log(`\n[6/6] ⭐ 同一屏连截 3 次（每轮间隔 600 ms）`);
    for (const [i, h] of hashes.entries()) console.log(`      第 ${i + 1} 次 ${h.slice(0, 24)}…`);
    console.log(
      distinct === 1
        ? '      ✅ 三次完全相同 —— 真 GUI 在这一屏上是确定的'
        : `      ❌ 有 ${distinct} 种结果 —— 真 GUI **不确定**，R2 必须额外处理（见报告）`,
    );

    await page.close();
    await browser.close();
  } finally {
    boot.kill();
    console.log('\n已关掉那个 dsh web 实例');
  }

  // ── 跨**实例**重复性：这才是七个焊点真正要的 ────────────────
  // 同一个实例里连截三次相同，可能只是因为「页面已经稳定了」。
  // 真正的验收是：**重新起一个 dsh web**（新 token、新端口、新进程）再截，
  // 出来的还应是同一个哈希。不然后续 4741 帧里的跨段重渲就不成立。
  if (SKIP_CROSS) {
    console.log('\n── 跨实例重复性：--skip-cross，跳过 ────────────────────');
    return 0;
  }
  console.log('\n── 跨实例重复性（重新 boot 一次再截）──────────────────');
  const { createHash: ch } = await import('node:crypto');
  const { chromium } = await import('playwright');
  /** @type {string[]} */
  const across = [];
  for (let i = 0; i < 2; i++) {
    const b2 = await bootDshWeb({ port: 0 });
    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const { page } = await openPinnedGui(browser, b2, VIEW);
    const buf = await page.screenshot({ type: 'png' });
    across.push(ch('sha256').update(buf).digest('hex'));
    writeFileSync(join(OUT, `across-${i}.png`), buf);
    console.log(`  实例 ${i + 1}（端口 ${b2.port}）→ ${across[i].slice(0, 24)}…`);
    await page.close();
    await browser.close();
    b2.kill();
  }
  console.log(
    new Set(across).size === 1
      ? '  ✅ 两个独立实例的同一屏**哈希相同** —— R2 的跨实例重复性成立'
      : '  ❌ 两个实例结果不同 —— R2 存在跨实例的不确定性，必须查出差异来源',
  );
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 探针失败：${e.message}`);
    return 1;
  }),
);
