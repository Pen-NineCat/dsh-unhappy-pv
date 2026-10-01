/**
 * film/content/example.js — **Phase 3 的管线自检画面**（不是 PV 的画面）。
 *
 * ⚠️ 作用域说明：引子（帧 0–419）的画面内容另有其人负责（见 `design-options.md`
 * 顶部「交给管线 Agent 实现」一节与 T3）。这里画的**只是**「一个移动的方块 + 帧号文字」，
 * 目的是让 Phase 3 的验收（24 帧短片、只重渲某几帧、双渲一致、worker 数无关）
 * 有东西可渲。**引子落地时替换本文件在 `engine/content.js` 里的注册**，不要改这里的预留结构。
 *
 * 纪律（`AGENTS.md` §2 规则 12）：**只许调 `film/kit/` 的接口**，不许直接碰 canvas API。
 * 所以下面没有一个 `ctx.fillRect` / `ctx.font` —— 全走 `kit/canvas.js` 与 `kit/text.js`。
 * ⚠️ 这一条是**踩过坑才写下的**：第一版这里写了 `chrome.font = '28px Consolas'` 再 `fillText`，
 * 结果中文渲染成一排豆腐块（Consolas 没有 CJK 字形）。
 * 正解是 `kit/text.js` 的字形图集 + 中文字体（`design-options.md` §1.11）。
 *
 * 纪律（规则 6/7）：每帧是 `t` 的纯函数，随机走 `frameRng(seed, n)`。
 * **图集是「跨帧不变的缓存」而不是「跨帧状态」**：它只依赖 `(字体, 字符集)`，与 `n` 无关，
 * 所以缓存它不会让 `frame(n)` 不再是纯函数。
 */

import { FPS, H, W, frameAt } from '../engine/clock.js';
import { ctx2d } from '../kit/canvas.js';
import { frameRng, pick } from '../kit/noise.js';
import { cellMetrics, drawText, glyphAtlas, registerFont, resolveFontFile } from '../kit/text.js';

/** 这个自检方块用的种子（固定值，不要随机化）。 */
export const SEED = 20261001;

/** 自检画面里的字符集（**预先枚举**，这样图集只烤一次）。 */
const ASCII = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
/**
 * 中文那一行会混排拉丁与空格（`这不是 PV 画面，是管线自检夹具`），
 * 所以这张图集的字符集必须**自带** ASCII 与空格 ——
 * ⚠️ 这是踩过的坑：只放汉字时，那一行的空格与 `PV` 会被 `drawText` 记成缺字形，
 * 空格还看不见，症状是「字挤在一起」而不是报错。
 */
const CJK = `${ASCII}PV中文自检画面这不是管线夹具引子第拍帧号随机，。`;

/**
 * 缓存的图集（键 = 字号）。见文件头：这不是跨帧状态。
 * @type {Map<string, {mono: any, cjk: any, monoM: any, cjkM: any}>}
 */
const ATLAS_CACHE = new Map();

/**
 * 惰性烤一套图集（拉丁用 Consolas、中文用微软雅黑）。
 * @param {number} monoSize
 */
function atlases(monoSize) {
  const key = `mono${monoSize}`;
  const hit = ATLAS_CACHE.get(key);
  if (hit) return hit;
  const monoPath = resolveFontFile(['consola.ttf', 'Consolas.ttf']);
  const cjkPath = resolveFontFile(['msyh.ttc', 'msyh.ttf']);
  const mono = glyphAtlas(registerFont(monoPath, monoSize, 'ex-mono'), ASCII);
  // 中文按 design-options §1.11 的系数放大：汉字步进 = 2 × 拉丁格宽
  const cjkSize = Math.round(monoSize * 2 * (mono.cellW / monoSize));
  const cjk = glyphAtlas(registerFont(cjkPath, cjkSize, 'ex-cjk'), CJK);
  const rec = { mono, cjk, monoM: cellMetrics(mono), cjkM: cellMetrics(cjk) };
  ATLAS_CACHE.set(key, rec);
  return rec;
}

/**
 * 把自检画面画进六层里。
 * @param {import('../engine/frame.js').FrameState} s
 */
export function drawExample(s) {
  const { n, stack } = s;
  const t = n / FPS;
  const bg = ctx2d(stack.background);
  const content = ctx2d(stack.content);
  const subject = ctx2d(stack.subject);
  const chrome = ctx2d(stack.chrome);

  // 1) background：底色 + 一条按帧推进的竖向渐变（证明「帧号真的在影响画面」）
  const phase = (n % FPS) / FPS;
  const g = bg.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05070c');
  g.addColorStop(
    1,
    `rgb(${8 + Math.round(phase * 24)},${12 + Math.round(phase * 10)},${24 + Math.round(phase * 30)})`,
  );
  bg.fillStyle = g;
  bg.fillRect(0, 0, W, H);

  // 2) content：一条「进度条」，横向按帧推进（不依赖任何隐藏状态）
  const barW = Math.round(((W - 200) * (n % (FPS * 4))) / (FPS * 4));
  content.fillStyle = '#1d4ed8';
  content.fillRect(100, H - 80, barW, 8);

  // 3) subject：**独立画布**上的那个方块（Phase 4 起镜头运动会作用在它上面）
  const g2 = frameRng(SEED, n);
  const x = Math.round(100 + ((W - 400) * (Math.sin(t * 0.8) + 1)) / 2);
  const y = Math.round(H / 2 - 120 + Math.sin(t * 1.7) * 80);
  subject.fillStyle = pick(g2, ['#f59e0b', '#fb7185', '#34d399']);
  subject.fillRect(x, y, 240, 240);

  // 4) chrome：每帧重画、永不被变换的「UI 框」与读数（走图集，不碰 ctx.font）
  chrome.strokeStyle = 'rgba(255,255,255,0.25)';
  chrome.lineWidth = 2;
  chrome.strokeRect(40.5, 40.5, W - 81, H - 81);

  const a = atlases(28);
  const line = `pipeline self-check  n=${n}  t=${t.toFixed(4)}s  frameAt(n)=${frameAt(t)}`;
  drawText(stack.chrome, a.mono, { x: 70, y: 110 - a.monoM.ascent }, line, { color: '#e5e7eb' });
  // 混排（中文 + 拉丁 + 空格）用**比例步进**：`mono: true` 会把拉丁撑成全角宽度
  drawText(stack.chrome, a.cjk, { x: 70, y: H - 128 }, '这不是 PV 画面，是管线自检夹具', {
    color: '#8b93a0',
    mono: false,
  });
}
