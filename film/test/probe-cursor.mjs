#!/usr/bin/env node
/**
 * film/test/probe-cursor.mjs — **量我们自己的页面**：输入框与那几个按钮的真实矩形。
 *
 * 为什么要有它：画面规格 §三 的路径契约规定鼠标的**形状**由 `(x,y)` 落在哪个控件推断
 * （「输入框矩形内 = I-beam；可点控件上 = 手型；其余 = 箭头」，判据就是 §2.2 的几何），
 * 而"落点与时刻正确"这条判据要求**落点真的在那个控件上**。
 * 所以图形侧需要一组**在帧坐标系里的控件矩形**，它必须是量出来的，不是算出来的：
 * 页面那一列的宽度由 dsh 自己的 CSS（`uV2eYG_*` + `.dsh-col` 的 clamp）决定，
 * 手算一遍迟早差几个像素，而差几个像素的症状是"箭头压在输入框边上"，肉眼很难判定。
 *
 * 本探针把 `body.js` 生成的页面在**左格尺寸（1152×1080）**下打开，读
 * `[data-composer-input]` / `.uV2eYG_add` / `.uV2eYG_primary` / `[data-composer-card]` / `#scroll`
 * 的 `getBoundingClientRect()`，然后与 `film/engine/layout.js` 的 `CONTROLS` **逐字段比对**。
 *
 * ⚠️ 比对是**零容差**的：`CONTROLS` 的值就该是这张表里的整数。
 *    改了 CSS（列宽、内边距、按钮尺寸）而没改 `CONTROLS` 时，它必须红 ——
 *    这条和 `shot.mjs --intro-scroll-check` 里"实测高 == COMPOSER_HEIGHT"是同一类守门。
 *
 * 用法：
 *   node film/test/probe-cursor.mjs                 # 量 + 比对（默认帧 430 有字 / 483 空）
 *   node film/test/probe-cursor.mjs --frames 430,600
 *   node film/test/probe-cursor.mjs --dump          # 把整棵输入框子树的矩形也打出来
 *
 * 退出码：0 一致 / 1 不一致或量不到 / 2 用法错误。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { H, W } from '../engine/clock.js';
import { ANCHORS, CONTROLS, LEFT_W } from '../engine/layout.js';
import { LAUNCH_ARGS } from '../lib/dsh-web.js';
import { serveStatic } from '../lib/static-server.js';
import { VENDOR_MOUNT } from '../pages/dsh-theme.js';

const GEN = 'out/gen';
const OUT = 'out/cursor-probe';

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ n, /** @type {any} */ d) => {
  const i = argv.indexOf(n);
  return i < 0 ? d : argv[i + 1];
};
const FRAMES = String(flag('--frames', '430,483'))
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));
const DUMP = argv.includes('--dump');

/** 要量的选择器 → `CONTROLS` 里的名字。 */
const SEL = {
  'composer.input': '[data-composer-input]',
  'composer.card': '[data-composer-card]',
  'composer.add': '.uV2eYG_add',
  'composer.send': '.uV2eYG_primary',
};

/**
 * 页面里读矩形。
 * @param {import('playwright').Page} page
 * @param {number} n
 */
async function measure(page, n) {
  const { body } = await import('../pages/body.js');
  const intro = await import('../pages/intro.js');
  // 左格尺寸 = 第一幕的矩形（§2.2：`leftWidthAt(n) === LEFT_W`，n ≥ 419）
  await page.setViewportSize({ width: LEFT_W, height: H });
  await page.evaluate((h) => /** @type {any} */ (window).__stage.setBody(h), body(n, { width: LEFT_W, height: H }));
  await page.evaluate((s) => /** @type {any} */ (window).__stage.setScroll(s), intro.scrollAtFrame(n, { height: H }));
  await page.evaluate(() => /** @type {any} */ (window).__stage.fontsReady());
  await page.waitForTimeout(150);

  return page.evaluate((/** @type {Record<string, string>} */ sel) => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [name, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) {
        out[name] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      out[name] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        // 还要 px 级的小数，用来判断"取整是否安全"（差 0.5px 时取整会骗人）
        exact: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100),
      };
    }
    const scroll = document.querySelector('#scroll');
    out['__scroll'] = scroll
      ? (() => {
          const r = scroll.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })()
      : null;
    return out;
  }, SEL);
}

async function main() {
  if (!existsSync(join(resolvePath(GEN), 'stage.html'))) {
    console.error(`缺少 ${GEN}/stage.html —— 先跑：node film/pages/gen-frames.js`);
    return 1;
  }
  mkdirSync(resolvePath(OUT), { recursive: true });
  const srv = await serveStatic(resolvePath(GEN), { mounts: VENDOR_MOUNT });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: LEFT_W, height: H }, deviceScaleFactor: 2 });
  await page.goto(`${srv.url}stage.html`, { waitUntil: 'load' });

  console.log('── 量控件矩形（我们自己的页面，左格 1152×1080）──────────');
  /** @type {Record<string, any>} */
  const all = {};
  try {
    for (const n of FRAMES) {
      const m = await measure(page, n);
      all[String(n)] = m;
      console.log(`\n帧 ${n}：`);
      for (const [name, r] of Object.entries(m)) {
        if (name === '__scroll' || !r) continue;
        console.log(`  ${name.padEnd(16)} x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}  ${String(r.w).padStart(4)}×${String(r.h).padStart(4)}   exact ${r.exact.join(', ')}`);
      }
      if (m.__scroll) console.log(`  ${'#scroll'.padEnd(16)} x=${m.__scroll.x} y=${m.__scroll.y}  ${m.__scroll.w}×${m.__scroll.h}`);
    }
  } finally {
    writeFileSync(join(resolvePath(OUT), 'controls.json'), JSON.stringify(all, null, 2), 'utf8');
  }

  // ── 与 layout.js 的 CONTROLS 比对（**零容差**）──────────────────────────────
  const problems = [];
  const names = Object.keys(CONTROLS);
  if (names.length === 0) {
    console.log('\n⚠️ layout.js 的 CONTROLS 还是空的 —— 把上面这几个矩形填进去，再跑一次这条比对。');
  } else {
    const [n0, m] = Object.entries(all)[0];
    console.log(`\n与 layout.js 的 CONTROLS 比对（用帧 ${n0} 那张）：`);
    for (const name of names) {
      const want = /** @type {any} */ (CONTROLS)[name];
      const got = m[name];
      if (!got) {
        problems.push(`CONTROLS["${name}"] 在页面上量不到（选择器 ${SEL[/** @type {keyof typeof SEL} */ (name)] ?? '(未登记选择器)'}）`);
        continue;
      }
      const same = want.x === got.x && want.y === got.y && want.w === got.w && want.h === got.h;
      console.log(
        `  ${same ? '✅' : '❌'} ${name.padEnd(16)} 常数 ${want.x},${want.y} ${want.w}×${want.h}` +
          `   实测 ${got.x},${got.y} ${got.w}×${got.h}`,
      );
      if (!same) {
        problems.push(
          `CONTROLS["${name}"] = ${JSON.stringify({ x: want.x, y: want.y, w: want.w, h: want.h })}，` +
            `实测 ${JSON.stringify({ x: got.x, y: got.y, w: got.w, h: got.h })}`,
        );
      }
    }
    // 锚点必须**落在**它该落的控件上：这就是"落点正确"的机器判据
    console.log('\n锚点落点检查：');
    for (const [name, p] of Object.entries(ANCHORS)) {
      const inside = names.filter((c) => {
        const r = /** @type {any} */ (CONTROLS)[c];
        return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
      });
      console.log(`  ${name.padEnd(16)} (${/** @type {any} */ (p).x}, ${/** @type {any} */ (p).y})  落在 ${inside.length ? inside.join(', ') : '（没有控件 —— 形状会是箭头）'}`);
    }
  }

  // 同一个控件在不同帧（有字 / 空）下必须一样，否则锚点就得逐帧算
  const keys = Object.keys(all);
  if (keys.length > 1) {
    const a = all[keys[0]];
    const b = all[keys[1]];
    for (const name of Object.keys(SEL)) {
      if (!a[name] || !b[name]) continue;
      const same = ['x', 'y', 'w', 'h'].every((k) => a[name][k] === b[name][k]);
      if (!same) {
        problems.push(
          `${name} 在帧 ${keys[0]} 与 ${keys[1]} 的矩形不同（${JSON.stringify(a[name])} vs ${JSON.stringify(b[name])}）` +
            ` —— 有字时输入框会长高？那光标锚点必须逐帧算，不能是常数`,
        );
      }
    }
  }

  if (DUMP) {
    const tree = await page.evaluate(() => {
      /** @param {Element} el @param {number} d */
      const walk = (el, d) => {
        const r = el.getBoundingClientRect();
        return {
          cls: String(el.className || '').slice(0, 60),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: (el.children.length === 0 ? el.textContent || '' : '').trim().slice(0, 40),
          children: d > 0 ? [...el.children].map((c) => walk(c, d - 1)) : [],
        };
      };
      const root = document.querySelector('[data-dsh-composer-frame]');
      return root ? walk(root, 9) : null;
    });
    writeFileSync(join(resolvePath(OUT), 'composer-frame-tree.json'), JSON.stringify(tree, null, 2), 'utf8');
    console.log(`\n明细 ${OUT}/composer-frame-tree.json`);
  }

  await page.close();
  await browser.close();
  await srv.close();

  console.log(`\n明细 ${OUT}/controls.json`);
  if (problems.length) {
    for (const p of problems) console.log(`  ❌ ${p}`);
    return 1;
  }
  console.log('结论：CONTROLS 与页面实测一致（零容差）。');
  void W;
  return 0;
}

process.exit(
  await main().catch((e) => {
    console.error(`\n❌ 探针失败：${/** @type {Error} */ (e).message}`);
    if (process.env.DSH_DEBUG) console.error(e.stack);
    return 1;
  }),
);
