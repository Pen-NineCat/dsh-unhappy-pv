/**
 * film/kit/post.js — 后期四件套：**残影 → 辉光 → 扫描线 → 暗角**（Phase 4）。
 *
 * 顺序不可换，理由（施工说明 §6 Phase 4 第 2 条 + `AGENTS.md` §7）：
 * 1. **残影**要在「新画面」和「上一帧」之间做，所以必须是第一个 —— 它得看见干净的本帧。
 * 2. **辉光**要吃到残影留下的亮部（这正是「拖尾发光」的来源）。
 * 3. **扫描线**是「显示器」的质感，盖在发光之上。
 * 4. **暗角**是镜头质感，最后压边。
 *
 * 三条硬纪律（都是验收项）：
 *
 * - **残影用 `lighten`（逐通道 max）而不是 `blend`**。`blend` 会让暗部也留痕，几帧就糊成一团。
 *   这条参考项目专门标了「最关键的一条」。
 * - **扫描线与暗角是常量，必须缓存**（`Map`）。每帧重建一张 1920×1080 的图会吃掉半个帧预算。
 * - **暗角在小图上算完再放大**（64×36 → 双线性），不是逐像素算 1920×1080 的距离。
 *
 * ⚠️ 性能（附录 C 记录 5 的实测）：全分辨率 `gaussianBlur` 在 1920×1080 上是 219 ms（`box`）/
 * 904 ms（核）。所以**辉光默认在 1/4 尺寸上模糊再放大** —— 这既省时间，又天然更「软」。
 */

import { createCanvas } from '@napi-rs/canvas';

import { ctx2d } from './canvas.js';
import { boxDownsample, difference, emptyRaw, gaussianBlur, readRaw } from './raster.js';
import { DEFAULTS } from './post-config.js';
import { frameRng } from './noise.js';

/**
 * 缓存命中计数（验收要求「第 2 帧起不重复构建」要看得到打点）。
 * @type {{scanline: number, scanlineHit: number, vignette: number, vignetteHit: number}}
 */
export const cacheStats = { scanline: 0, scanlineHit: 0, vignette: 0, vignetteHit: 0 };

/** 常量缓存。键空间**有限**（只有尺寸 × 参数），所以用普通 `Map` 不设上限。 */
const CACHE = {
  /** @type {Map<string, import('@napi-rs/canvas').Canvas>} */
  scanline: new Map(),
  /** @type {Map<string, import('@napi-rs/canvas').Canvas>} */
  vignette: new Map(),
};

/** 清缓存 + 归零计数（测试用）。 */
export function resetCache() {
  CACHE.scanline.clear();
  CACHE.vignette.clear();
  cacheStats.scanline = 0;
  cacheStats.scanlineHit = 0;
  cacheStats.vignette = 0;
  cacheStats.vignetteHit = 0;
}

/**
 * 一张 `w×h` 的画布。
 * @param {number} w @param {number} h
 */
function makeCanvas(w, h) {
  return createCanvas(w, h);
}

/**
 * 一张「只剩 RGB 乘性系数」的画布（alpha 满）。
 * @param {import('./pixels.js').RawImage} img
 * @returns {import('@napi-rs/canvas').Canvas}
 */
function rawToCanvas(img) {
  const cv = makeCanvas(img.width, img.height);
  const ctx = ctx2d(cv);
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return cv;
}

// ── 1. 残影（trail）──────────────────────────────────────────────────────

/**
 * 残影：`max(本帧, 上一帧 × decay)`，**逐通道取最大**。
 *
 * 语义要点：
 * - 用 max 而不是线性混合 → **亮部留痕、暗部立刻恢复**。这是「拖尾」而不是「糊」的分界线。
 * - `decay` 是每帧的衰减：0 = 不残留（等价关闭），1 = 永不衰减（会烧屏）。
 * - 残影会**原地修改 `dst`**。
 *
 * @param {any} dst 本帧（原地）—— 或一个 `RawImage`
 * @param {?any} prev 上一帧的 canvas / RawImage / `null`
 * @param {number} amount 残影强度 `0..1`
 * @returns {{applied: boolean, changed: number}}
 */
export function trail(dst, prev, amount) {
  if (!prev || amount <= 0) return { applied: false, changed: 0 };
  const a = toRaw(dst);
  const b = toRaw(prev);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `trail: 本帧 ${a.width}×${a.height} 与上一帧 ${b.width}×${b.height} 尺寸不一致\n` +
        `  hint: 分辨率变了不能沿用旧的 prev（换分辨率要重跑整段）`,
    );
  }
  const decay = 1 - amount;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const ghost = b.data[i + c] * decay;
      if (ghost > a.data[i + c]) {
        a.data[i + c] = ghost; // Uint8ClampedArray 自己会截断，不用手动 round/clamp
        changed++;
      }
    }
  }
  writeRaw(dst, a);
  return { applied: true, changed };
}

// ── 2. 辉光（bloom）─────────────────────────────────────────────────────

/**
 * 辉光：**模糊后加回自己**。
 *
 * 两种模式：
 * - `'screen'`（默认，便宜）：`out = 255 - (255-a)(255-b)/255`，**保高光不炸白**，
 *   而且只要一次 `ctx.globalCompositeOperation = 'screen'` 的 `drawImage`，不用逐像素。
 *   它数学上就是「饱和加法」的一种，但**不裁剪**（255 是极限而不是屋顶）。
 * - `'plus'`：逐像素饱和加法 `min(255, a+b)`，视觉更「爆」，但要过一遍像素。
 *
 * 模糊在 `1/bloomDown` 尺寸上做（性能：见文件头）。
 * @param {any} dst 原地
 * @param {number} amount `0..1`
 * @param {{sigma?: number, down?: number, mode?: 'screen'|'plus', blurMode?: 'box'|'kernel'}} [opts]
 * @returns {{blurred: boolean, ms: number}}
 */
export function bloom(dst, amount, opts = {}) {
  if (amount <= 0) return { blurred: false, ms: 0 };
  const sigma = opts.sigma ?? DEFAULTS.bloomSigma;
  const down = Math.max(1, Math.floor(opts.down ?? DEFAULTS.bloomDown));
  const mode = opts.mode ?? DEFAULTS.bloomMode;
  const blurMode = opts.blurMode ?? DEFAULTS.blurMode;

  const ctx = ctx2d(dst);
  const w = dst.width ?? ctx.canvas.width;
  const h = dst.height ?? ctx.canvas.height;
  const sw = Math.max(1, Math.round(w / down));
  const sh = Math.max(1, Math.round(h / down));

  // 降采样 → 模糊 → 放大回去
  const small = boxDownsample(readRaw(dst), sw, sh);
  const blurred = gaussianBlur(small, sigma, { box: blurMode === 'box' });

  if (mode === 'screen') {
    // 直接把模糊后的图放大画回去（'screen' 是自己和自己叠加）
    const layer = rawToCanvas(blurred);
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.max(0, Math.min(1, amount));
    ctx.imageSmoothingEnabled = true; // 放大要插值，否则 1/4 的格子看得出来
    ctx.drawImage(layer, 0, 0, sw, sh, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevAlpha;
    return { blurred: true, ms: 0 };
  }

  // 'plus'：逐像素饱和加法（放大用最近邻，保持确定性且便宜）
  const base = readRaw(dst);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / w));
      const si = (sy * sw + sx) * 4;
      const di = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const add = blurred.data[si + c] * amount;
        const v = base.data[di + c] + add;
        base.data[di + c] = v > 255 ? 255 : v;
      }
    }
  }
  writeRaw(dst, base);
  return { blurred: true, ms: 0 };
}

// ── 3. 扫描线（scanlines）───────────────────────────────────────────────

/**
 * 扫描线：一张**缓存的常量图**，用 `multiply` 叠上去。
 *
 * ⚠️ **不能用 `createPattern(1×period, 'repeat')`**（踩过的坑，2026-10-01）：
 * Canvas 会把 pattern 缩放到填充区域，1×3 的瓦片铺到 8×6 上会被**拉伸**，
 * 于是「第 0 行暗、第 1/2 行亮」变成三行都被压暗一点 —— 期望 `[100,200,200]` 实测 `[190,190,190]`。
 * 所以这里**直接把常量图做成画面尺寸**，1:1 贴上去。成本一样是常数（缓存住就不重建）。
 * @param {any} dst 原地
 * @param {{period?: number, amount?: number}} [opts]
 */
export function scanlines(dst, opts = {}) {
  const period = Math.max(2, Math.round(opts.period ?? DEFAULTS.scanlinePeriod));
  const amount = opts.amount ?? DEFAULTS.scanlineAmount;
  if (amount <= 0) return;
  const ctx = ctx2d(dst);
  const w = dst.width ?? ctx.canvas.width;
  const h = dst.height ?? ctx.canvas.height;
  const tile = scanlineTile(period, amount, w, h);
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(tile, 0, 0);
  ctx.globalCompositeOperation = prevOp;
}

/**
 * 取（或建）扫描线常量图。**缓存，第 2 帧起不重建**。
 * @param {number} period @param {number} amount
 * @param {number} [w] 画面宽（默认 1，用于「只要一行瓦片」的场合）
 * @param {number} [h] 画面高
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function scanlineTile(period, amount, w = 1, h = period) {
  const key = `${period}|${amount}|${w}x${h}`;
  const hit = CACHE.scanline.get(key);
  if (hit) {
    cacheStats.scanlineHit++;
    return hit;
  }
  cacheStats.scanline++;
  const tile = makeCanvas(w, h);
  const ctx = ctx2d(tile);
  const dark = Math.max(0, Math.min(255, Math.round(255 * (1 - amount))));
  for (let y = 0; y < h; y++) {
    // 一行暗、其余亮：亮度当乘性系数
    const lit = y % period === 0 ? dark : 255;
    ctx.fillStyle = `rgb(${lit},${lit},${lit})`;
    ctx.fillRect(0, y, w, 1);
  }
  CACHE.scanline.set(key, tile);
  return tile;
}

// ── 4. 暗角（vignette）──────────────────────────────────────────────────

/**
 * 暗角：**在小图上算完再双线性放大**，用 `multiply` 叠上去。
 * @param {any} dst 原地
 * @param {{strength?: number, power?: number, down?: number}} [opts]
 */
export function vignette(dst, opts = {}) {
  const strength = opts.strength ?? DEFAULTS.vignetteStrength;
  if (strength <= 0) return;
  const power = opts.power ?? DEFAULTS.vignettePower;
  const down = Math.max(8, Math.round(opts.down ?? DEFAULTS.vignetteDown));
  const ctx = ctx2d(dst);
  const w = dst.width ?? ctx.canvas.width;
  const h = dst.height ?? ctx.canvas.height;
  const mask = vignetteMask(w, h, strength, power, down);
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true; // 小图放大必须插值，否则看得出 64×36 的格子
  ctx.drawImage(mask.canvas, 0, 0, mask.w, mask.h, 0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = prevOp;
}

/**
 * 取（或建）暗角遮罩：宽度固定 `down`，高度按画面比例。
 * **缓存，第 2 帧起不重建**。
 * @param {number} w @param {number} h
 * @param {number} strength @param {number} power @param {number} down
 * @returns {{canvas: import('@napi-rs/canvas').Canvas, w: number, h: number}}
 */
export function vignetteMask(w, h, strength, power, down) {
  const mw = Math.min(down, w);
  const mh = Math.max(1, Math.round((h / w) * mw));
  const key = `${mw}x${mh}|${strength}|${power}`;
  const hit = CACHE.vignette.get(key);
  if (hit) {
    cacheStats.vignetteHit++;
    return hit;
  }
  cacheStats.vignette++;
  const canvas = makeCanvas(mw, mh);
  const ctx = ctx2d(canvas);
  const id = ctx.createImageData(mw, mh);
  const cx = (mw - 1) / 2;
  const cy = (mh - 1) / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const r = Math.hypot(x - cx, y - cy) / maxR; // 0 中心 → 1 最远角
      // 中心 1（不压暗）→ 边缘 1-strength
      const v = 1 - strength * Math.pow(r, power);
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * mw + x) * 4;
      id.data[i] = c;
      id.data[i + 1] = c;
      id.data[i + 2] = c;
      id.data[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  const rec = { canvas, w: mw, h: mh };
  CACHE.vignette.set(key, rec);
  return rec;
}

// ── 串起来 ──────────────────────────────────────────────────────────────

/**
 * 后期四件套，**按固定顺序**跑（残影 → 辉光 → 扫描线 → 暗角）。
 *
 * ⚠️ 就地修改 `img` 并返回它。传进来的是本帧的**合成结果**（六层叠完）。
 * @param {any} img 本帧（canvas；原地）
 * @param {?any} prev 上一帧（残影用；`null` = 这一段的第一帧）
 * @param {import('./post-config.js').PostConfig} cfg
 * @param {{trail?: boolean, bloom?: boolean, scanlines?: boolean, vignette?: boolean}} [enable]
 * @returns {{trail: number, bloom: boolean, scanlines: boolean, vignette: boolean}}
 */
export function post(img, prev, cfg, enable = {}) {
  const on = {
    trail: enable.trail ?? true,
    bloom: enable.bloom ?? true,
    scanlines: enable.scanlines ?? true,
    vignette: enable.vignette ?? true,
  };
  const r = { trail: 0, bloom: false, scanlines: false, vignette: false };

  if (on.trail) r.trail = trail(img, prev, cfg.trailAmount).changed;

  if (on.bloom) {
    bloom(img, cfg.bloomAmount, {
      sigma: cfg.bloomSigma,
      down: cfg.bloomDown,
      mode: cfg.bloomMode,
      blurMode: cfg.blurMode,
    });
    r.bloom = true;
  }

  if (on.scanlines && cfg.scanlineAmount > 0) {
    scanlines(img, { period: cfg.scanlinePeriod, amount: cfg.scanlineAmount });
    r.scanlines = true;
  }

  if (on.vignette && cfg.vignetteStrength > 0) {
    vignette(img, {
      strength: cfg.vignetteStrength,
      power: cfg.vignettePower,
      down: cfg.vignetteDown,
    });
    r.vignette = true;
  }
  return r;
}

// ── 5. 逐格延迟转场（reveal）────────────────────────────────────────────

/**
 * 逐格延迟转场：`old` 在 `delay(x,y) <= t` 的格子上被 `new` 替换。
 *
 * 实现要点（施工说明 §6 Phase 4 第 3 条）：
 * - **mask 在格子分辨率算完再 `NEAREST` 放大** —— 逐像素 `hypot` 是纯浪费，方块感也是要的质感
 * - **只在 old/new「有墨」的格子叠解码字符**（用 `difference()` 判断），
 *   否则字符会画到背景上，变成一层噪点
 * - `t` 相同时结果**一致**（没有任何隐藏状态）
 *
 * @param {any} dst 输出（原地写）
 * @param {any} oldImg
 * @param {any} newImg
 * @param {number} t 当前时刻（秒）
 * @param {import('../engine/transitions.js').DelayFn} delay
 * @param {{
 *   cell?: number, inkThreshold?: number, glyphs?: ?string,
 *   glyphSeed?: number, glyphColor?: string, useGlyphs?: boolean,
 * }} [opts]
 * @returns {{switched: number, total: number, glyphCells: number, p: number}}
 *   `p` 是已切换格子的比例
 */
export function reveal(dst, oldImg, newImg, t, delay, opts = {}) {
  const cell = Math.max(1, Math.round(opts.cell ?? 16));
  const inkThreshold = opts.inkThreshold ?? 8;
  const useGlyphs = opts.useGlyphs ?? Boolean(opts.glyphs);
  const glyphs = opts.glyphs ?? '01<>[]{}#$%&*+=?/\\|';
  const glyphSeed = opts.glyphSeed ?? 1;

  const a = readRaw(oldImg);
  const b = readRaw(newImg);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `reveal: old ${a.width}×${a.height} 与 new ${b.width}×${b.height} 尺寸不一致`,
    );
  }
  const w = a.width;
  const h = a.height;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);

  // 1) 格子分辨率上决定哪些格已经切换；顺带统计「有墨」的格子
  const switched = new Uint8Array(gw * gh);
  const inked = new Uint8Array(gw * gh);
  let nSwitched = 0;
  let nGlyphCells = 0;

  // 「有墨」的判据：这格内 new 与 old 有明显差异，或 new 自己不接近纯黑
  const diff = difference(a, b);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * cell;
      const y0 = gy * cell;
      const x1 = Math.min(w, x0 + cell);
      const y1 = Math.min(h, y0 + cell);
      let maxDiff = 0;
      let maxNew = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const d = Math.max(diff.data[i], diff.data[i + 1], diff.data[i + 2]);
          if (d > maxDiff) maxDiff = d;
          const nv = Math.max(b.data[i], b.data[i + 1], b.data[i + 2]);
          if (nv > maxNew) maxNew = nv;
        }
      }
      const idx = gy * gw + gx;
      inked[idx] = maxDiff >= inkThreshold || maxNew >= inkThreshold ? 1 : 0;

      // 用格中心取样 delay（格内的 delay 变化被有意忽略 —— 这就是「逐格」）
      const ct = delay(x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2);
      if (ct <= t) {
        switched[idx] = 1;
        nSwitched++;
      }
    }
  }

  // 2) 按 mask 把 old / new 拼出来
  const out = emptyRaw(w, h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cell));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / cell));
      const src = switched[gy * gw + gx] ? b : a;
      const i = (y * w + x) * 4;
      out.data[i] = src.data[i];
      out.data[i + 1] = src.data[i + 1];
      out.data[i + 2] = src.data[i + 2];
      out.data[i + 3] = src.data[i + 3];
    }
  }
  writeRaw(dst, out);

  // 3) 正在切换的格子上叠解码字符（只在有墨处）
  if (useGlyphs) {
    const ctx = ctx2d(dst);
    const fontSize = Math.max(6, Math.round(cell * 0.8));
    ctx.font = `${fontSize}px Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = opts.glyphColor ?? '#9fe8ff';
    ctx.globalAlpha = 0.85;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const idx = gy * gw + gx;
        const ct = delay(gx * cell + cell / 2, gy * cell + cell / 2);
        // 「正在切换」= 已经到点、但还没过去一个格子的时间
        if (ct > t || t - ct > 0.08 || !inked[idx]) continue;
        const g = frameRng(glyphSeed, Math.round(t * 24) * 7919 + idx);
        const ch = glyphs[Math.min(glyphs.length - 1, Math.floor(g() * glyphs.length))];
        ctx.fillText(ch, gx * cell, gy * cell);
        nGlyphCells++;
      }
    }
    ctx.globalAlpha = 1;
  }

  return { switched: nSwitched, total: gw * gh, glyphCells: nGlyphCells, p: nSwitched / (gw * gh) };
}

// ── 小工具 ──────────────────────────────────────────────────────────────

/**
 * 把 canvas / RawImage 统一成 `RawImage`。
 *
 * ⚠️ **别用 `x.data` 判定**（踩过的坑，2026-10-01）：`@napi-rs/canvas` 的 `Canvas` 上有一个
 * **`data()` 方法**，所以 `'data' in canvas === true`、`!!canvas.data === true`。
 * 最早这里写的是 `x && x.data && x.width ? x : readRaw(x)`，于是**每个 canvas 都被当成
 * RawImage 直接返回**，而它的 `.data` 是个函数 —— `trail()` / `reveal()` 于是安静地什么都不写。
 * 症状极隐蔽：`trail()` 返回 `changed: 0`、画面完全不变，但不报错。
 *
 * 正确判据是「`data` 是不是**类数组**」＋「有没有 `getContext`」。
 * @param {any} x
 * @returns {import('./pixels.js').RawImage}
 */
function toRaw(x) {
  if (x && typeof x.getContext === 'function') return readRaw(x); // Canvas
  if (x && x.data && typeof x.data.length === 'number' && x.width > 0) {
    return /** @type {any} */ (x); // 已经是 RawImage / ImageData
  }
  throw new Error(
    `post: 这个对象既不是 Canvas 也不是 RawImage（keys: ${x ? Object.keys(x).join(',') || '(无)' : String(x)}）`,
  );
}

/**
 * 把 `RawImage` 写回 canvas（原地）；如果本来就是 `RawImage` 就直接改它。
 * @param {any} dst @param {import('./pixels.js').RawImage} img
 */
function writeRaw(dst, img) {
  if (dst && typeof dst.getContext === 'function') {
    const ctx = ctx2d(dst);
    const id = ctx.createImageData(img.width, img.height);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
    return;
  }
  // 本来就是 RawImage：前面已经就地改过了，什么都不用做
}

export { emptyRaw };
