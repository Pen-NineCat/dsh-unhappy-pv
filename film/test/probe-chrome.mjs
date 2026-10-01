/**
 * film/test/probe-chrome.mjs — **量真 dsh 界面的"壳"占多少像素**（只读探针）。
 *
 * 为什么要有它：作者动态检查时问「为什么没有侧栏和下方的输入框」。
 * 答案不是一个"要/不要"，而是一个**构图取舍**，取舍要用数说话：
 *
 * - 侧栏（`pI_x6G_sidebarCol`）宽多少？
 * - 输入框那一条（`wSkVaW_composerSeat`）高多少？
 * - 去掉这两条之后，**聊天内容区还剩多少像素**？那才是引子真正要显示的地方。
 *
 * 再顺手量一件同样重要的事：真界面的**对话列宽**（`--dsh-chat-content-width`），
 * 因为 §1.6 要求「截图尺寸 = 目标矩形 1:1」，而列宽决定一行能放多少字。
 *
 * 用法：node film/test/probe-chrome.mjs [--width 960] [--height 640] [--dpr 1]
 * 退出码：0 成功 / 1 失败
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LAUNCH_ARGS, bootDshWeb, openPinnedGui } from '../lib/dsh-web.js';

const argv = process.argv.slice(2);
const num = (/** @type {string} */ n, /** @type {number} */ d) =>
  argv.includes(n) ? Number(argv[argv.indexOf(n) + 1]) : d;
const VIEW = {
  width: num('--width', 960),
  height: num('--height', 640),
  deviceScaleFactor: num('--dpr', 1),
  settleMs: num('--settle-ms', 4000),
};
const OUT = 'out/chrome';

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('── 真 dsh 界面的"壳"尺寸 ──────────────────────────────');
  console.log(`视口 ${VIEW.width}×${VIEW.height} @dpr${VIEW.deviceScaleFactor}`);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const boot = await bootDshWeb({ port: 0 });
  try {
    const { page } = await openPinnedGui(browser, boot, VIEW);

    // `--dump-composer`：把输入框那棵子树的**结构 + 矩形 + 文本**打出来。
    // 建 R1 的输入框时用它当图纸（类名、层数、每层多高，全部是量出来的，不是猜的）。
    if (argv.includes('--dump-composer')) {
      const tree = await page.evaluate(() => {
        /** @param {Element} el @param {number} depth */
        const walk = (el, depth) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          /** @type {{tag: string, cls: string, rect: number[], text: string, display: string, pad: string, radius: string, bg: string, children: any[]}} */
          const node = {
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 90),
            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            text: (el.children.length === 0 ? el.textContent || '' : '').trim().slice(0, 60),
            display: cs.display,
            pad: `${cs.paddingTop}/${cs.paddingRight}/${cs.paddingBottom}/${cs.paddingLeft}`,
            radius: cs.borderTopLeftRadius,
            bg: cs.backgroundColor,
            attrs: [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(' '),
            children: depth > 0 ? [...el.children].map((c) => walk(c, depth - 1)) : [],
          };
          return node;
        };
        const seat = document.querySelector('[class*="composerSeat"]');
        return seat ? walk(seat, 9) : null;
      });
      if (!tree) {
        console.error('没找到 composerSeat');
        return 1;
      }
      writeFileSync(join(OUT, 'composer-tree.json'), JSON.stringify(tree, null, 2), 'utf8');
      /** @param {any} node @param {number} d */
      const print = (node, d) => {
        const pad = '  '.repeat(d);
        const [x, y, w, h] = node.rect;
        console.log(
          `${pad}${node.tag}.${node.cls.split(' ').slice(0, 2).join('.')}  ${w}×${h}@(${x},${y})  ${node.display}` +
            `${node.radius !== '0px' ? `  r=${node.radius}` : ''}${node.pad !== '0px/0px/0px/0px' ? `  pad=${node.pad}` : ''}` +
            `${node.attrs ? `  [${node.attrs}]` : ''}${node.text ? `  "${node.text}"` : ''}`,
        );
        for (const c of node.children) print(c, d + 1);
      };
      console.log('\n输入框子树（depth≤6）：');
      print(tree, 0);
      console.log(`\n明细 ${OUT}/composer-tree.json`);
      await page.close();
      return 0;
    }

    const info = await page.evaluate(() => {
      /** @param {string} sel */
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          sel,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          display: getComputedStyle(el).display,
        };
      };
      const body = document.body;
      const cs = getComputedStyle(body);
      // 聊天内容列宽：真界面由 JS 写在内联变量上，读不到就用 CSS 里的 clamp 默认值
      const chatW = cs.getPropertyValue('--dsh-chat-content-width').trim() || '(未设置 → 走 clamp 默认)';
      // 候选项：把能认出来的"壳"都量一遍
      const cands = [
        'pI_x6G_sidebarCol',
        'pI_x6G_centerCol',
        'pI_x6G_rightbarCol',
        'wSkVaW_root',
        'wSkVaW_header',
        'wSkVaW_scrollBody',
        'wSkVaW_composerSeat',
        'wSkVaW_viewArea',
        'EvIC1a_frame',
        'EvIC1a_column',
        'EvIC1a_scroll',
      ];
      const rects = cands.map((c) => box(`[class*="${c}"]`)).filter(Boolean);
      return {
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        chatContentWidth: chatW,
        composerHeight: cs.getPropertyValue('--dsh-composer-height').trim() || '(未设置)',
        scrollbarWidth: cs.getPropertyValue('--dsh-scrollbar-width').trim() || '(未设置)',
        rects,
        body: { w: body.clientWidth, h: body.clientHeight },
      };
    });

    console.log(`聊天内容列宽 --dsh-chat-content-width = ${info.chatContentWidth}`);
    console.log(`输入框高   --dsh-composer-height      = ${info.composerHeight}`);
    console.log('');
    console.log('元素矩形（CSS px）：');
    for (const r of info.rects) {
      console.log(
        `  ${r.sel.padEnd(26)} x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}` +
          `  ${String(r.w).padStart(4)}×${String(r.h).padStart(4)}  ${r.display}`,
      );
    }
    const side = info.rects.find((r) => r.sel.includes('sidebarCol'));
    const seat = info.rects.find((r) => r.sel.includes('composerSeat'));
    const center = info.rects.find((r) => r.sel.includes('centerCol'));
    console.log('');
    console.log('结论（用来做构图取舍的三个数）：');
    console.log(`  侧栏宽 ${side ? side.w : '?'} px · 输入框那一条高 ${seat ? seat.h : '?'} px`);
    if (center) {
      console.log(
        `  主区 ${center.w}×${center.h}；去掉输入框后**聊天可见高 ≈ ${center.h - (seat ? seat.h : 0)} px**` +
          `${side ? `；再去掉侧栏则宽只剩 ${center.w} px` : ''}`,
      );
    }
    console.log('');
    console.log('对照：R1 现在把聊天列按 960×640 里 760px 宽渲染（`dsh-theme` 的 .dsh-col）。');

    writeFileSync(join(OUT, 'chrome.json'), JSON.stringify(info, null, 2), 'utf8');
    writeFileSync(join(OUT, `real-gui-${VIEW.width}x${VIEW.height}.png`), await page.screenshot({ type: 'png' }));
    console.log(`明细 ${OUT}/chrome.json · 截图 ${OUT}/real-gui-${VIEW.width}x${VIEW.height}.png`);
    await page.close();
  } finally {
    boot.kill();
  }
  await browser.close();
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 探针失败：${/** @type {Error} */ (e).message}`);
    return 1;
  }),
);
