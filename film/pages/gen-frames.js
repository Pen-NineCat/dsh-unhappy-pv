#!/usr/bin/env node
/**
 * film/pages/gen-frames.js — 把「舞台 + 本地资源 + 帧清单」生成到 `out/gen/`（Phase 5）。
 *
 * 它**不截图**，只准备截图要的东西（截图在 `shot.mjs`）。分两步的好处：
 * 生成物可以单独检查（`out/gen/stage.html` 用浏览器直接打开就能看），
 * 而截图器只需要认 `out/gen/` 这一个目录。
 *
 * 产物（全部落在被忽略的 `out/` 下，可一条命令重建）：
 *
 * | 文件 | 作用 |
 * |---|---|
 * | `out/gen/stage.html` | 截图舞台（七个焊点的宿主） |
 * | `out/gen/stage.css` | 页面 CSS（**内联进文件**，少一个请求就少一个 404 可能） |
 * | `out/gen/assets/probe-dot.svg` | 第 2 个焊点要等的本地图片（`img.decode()`） |
 * | `out/gen/frames.json` | 帧清单：帧号、`t`、滚动位置、正文长度与哈希 |
 *
 * **帧清单里不存正文**：正文由 `body(n)` 现算（它是纯函数），
 * 清单只存「每帧应该长什么样」的指纹，用来做 ⭐ 帧数对账与「相同 body 不重写 DOM」的判定。
 *
 * 用法：
 *   node film/pages/gen-frames.js
 *   node film/pages/gen-frames.js --range 0 419        # 只生成引子那一段的清单
 *   node film/pages/gen-frames.js --frames 0,144,251   # 只生成这几帧
 *
 * 退出码：0 成功 / 1 失败 / 2 用法错误。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { END_T, FPS, FRAME_COUNT, describe as describeClock } from '../engine/clock.js';
import { VARIANTS, body, pageCss, scrollAtFrame } from './body.js';
import { VENDOR_MOUNT, assertThemeAssets, themeHead, themeScript } from './dsh-theme.js';
import { describe as describeIntro } from './intro.js';
import { STAGE_HTML } from './stage-html.js';

const OUT = 'out/gen';

/**
 * 第 2 个焊点要等的本地图片。**自己生成**，不搬参考项目或 dsh 的任何资产
 * （`AGENTS.md` §2 规则 9 / §9）。
 * @param {number} size
 * @returns {string} SVG
 */
function probeDotSvg(size = 24) {
  const r = size / 2 - 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#4d6bfe" stroke-width="2"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${Math.max(1, r / 3)}" fill="#4d6bfe"/>
</svg>
`;
}

/**
 * 用法错误（退出码 2）。
 */
class UsageError extends Error {}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{frames: ?number[], out: string, variant: 'intro'|'probe', theme: 'dark'|'light'}} */
  const o = { frames: null, out: OUT, variant: 'intro', theme: 'dark' };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--range': {
        const a = Number(argv[++i]);
        const b = Number(argv[++i]);
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw new UsageError('--range A B 都要是整数');
        if (b < a) throw new UsageError(`--range 的 B(${b}) 小于 A(${a})`);
        o.frames = [];
        for (let n = a; n <= b; n++) o.frames.push(n);
        break;
      }
      case '--frames': {
        const v = argv[++i];
        if (v === undefined) throw new UsageError('--frames 缺参数值');
        o.frames = v.split(',').map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n)) throw new UsageError(`--frames 里 "${s}" 不是整数帧号`);
          return n;
        });
        break;
      }
      case '--out':
        o.out = argv[++i] ?? OUT;
        break;
      case '--variant': {
        const v = /** @type {any} */ (argv[++i]);
        if (!VARIANTS.includes(v)) throw new UsageError(`--variant 只能是 ${VARIANTS.join(' / ')}，收到 "${v}"`);
        o.variant = v;
        break;
      }
      case '--theme': {
        const v = /** @type {any} */ (argv[++i]);
        if (v !== 'dark' && v !== 'light') throw new UsageError(`--theme 只能是 dark / light，收到 "${v}"`);
        o.theme = v;
        break;
      }
      case '-h':
      case '--help':
        console.log(
          [
            '用法：node film/pages/gen-frames.js [选项]',
            '',
            '  --range A B       只生成 [A, B] 闭区间的清单',
            '  --frames 1,2,3    只生成这几帧',
            '  --out <dir>       输出目录，默认 out/gen',
            '  --variant <v>     页面变体：intro（默认，引子真页面）/ probe（回归夹具）',
            '  --theme dark|light 主题，默认 dark',
            '',
            `画布：${describeClock()}`,
            '退出码：0 成功 / 1 失败 / 2 用法错误',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        throw new UsageError(`未知参数 "${argv[i]}"`);
    }
  }
  return o;
}

/**
 * 一个稳定的字符串哈希（只为「body 有没有变」用，不参与画面）。
 * ⚠️ 与 `stage-html.js` 里那份实现必须一致（同一个 FNV-1a），否则焊点 4 的判定会永远说「变了」。
 * @param {string} s
 * @returns {string}
 */
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }

  const frames = o.frames ?? Array.from({ length: FRAME_COUNT }, (_, i) => i);
  for (const n of frames) {
    if (n < 0 || n >= FRAME_COUNT) {
      console.error(`帧 ${n} 越界（有效范围 0..${FRAME_COUNT - 1}）`);
      return 2;
    }
  }

  mkdirSync(join(o.out, 'assets'), { recursive: true });

  // 0) R1 的样式：四份都在？不在就**现在**报错，别等到截了 4741 帧才发现全是浅色
  const themeAssets = assertThemeAssets();

  // 1) 舞台：CSS **内联**进 HTML（少一个请求就少一个 404 可能），主题头写在 `<head>` 里。
  //    样式表用 `/vendor/...` 引用 —— `shot.mjs` 会用 VENDOR_MOUNT 把 film/vendor 挂上去。
  const head = themeHead({ theme: o.theme });
  const html = STAGE_HTML.replace(
    '<link rel="stylesheet" href="./stage.css" />',
    `${head}\n<style>\n${pageCss()}\n</style>`,
  ).replace(
    '</body>',
    `${themeScript(o.theme)}\n</body>`,
  );
  writeFileSync(join(o.out, 'stage.html'), html, 'utf8');
  // 同时写一份独立 CSS，方便人直接看（顺便当参考）
  writeFileSync(join(o.out, 'stage.css'), pageCss(), 'utf8');

  // 2) 本地图片资源
  writeFileSync(join(o.out, 'assets', 'probe-dot.svg'), probeDotSvg(24), 'utf8');

  // 3) 帧清单（✅ 帧数对账：编号必须连续、数量必须对得上）
  /** @type {{n: number, t: number, scroll: number, bodyLen: number, bodyHash: string}[]} */
  const manifest = frames.map((n) => {
    const b = body(n, { variant: o.variant });
    return {
      n,
      t: n / FPS,
      scroll: scrollAtFrame(n, { variant: o.variant }),
      bodyLen: b.length,
      bodyHash: hashString(b),
    };
  });
  const expected = frames.length;
  if (manifest.length !== expected) {
    console.error(`⭐ 帧数对账失败：清单 ${manifest.length} ≠ 期望 ${expected}`);
    return 1;
  }
  for (let i = 0; i < manifest.length; i++) {
    if (manifest[i].n !== frames[i]) {
      console.error(`⭐ 帧数对账失败：第 ${i} 项帧号 ${manifest[i].n} ≠ ${frames[i]}`);
      return 1;
    }
  }

  writeFileSync(
    join(o.out, 'frames.json'),
    JSON.stringify({ fps: FPS, endT: END_T, count: manifest.length, frames: manifest }, null, 2),
    'utf8',
  );

  console.log(`画布   ${describeClock()}`);
  console.log(`输出   ${o.out}/`);
  console.log(`  stage.html        ${Buffer.byteLength(html)} 字节（主题样式 + 内联 CSS）`);
  console.log(`  assets/probe-dot.svg`);
  console.log(`  frames.json       ${manifest.length} 帧`);
  console.log(`变体   ${o.variant} · 主题 ${o.theme}`);
  if (o.variant === 'intro') console.log(describeIntro().split('\n').map((l) => `  ${l}`).join('\n'));
  console.log(`样式   ${themeAssets.files.length} 份：${themeAssets.files.map((f) => f.replace(/\\/g, '/')).join('  ')}`);
  console.log(`挂载   ${Object.entries(VENDOR_MOUNT).map(([k, v]) => `${k} → ${v}`).join(', ')}（shot.mjs 用同一份，别再写一个）`);
  console.log(`  ✅ 帧数对账：${manifest.length} 帧，编号连续 ${manifest[0].n}..${manifest[manifest.length - 1].n}`);
  console.log('');
  console.log('下一步：node film/pages/shot.mjs --range 0 419');
  return 0;
}

// 只有直接跑这个文件时才执行 main（被测试 import 时不执行）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main();
