/**
 * film/kit/text.js — 字体注册、**字形图集**、整数网格排版（PIL 的 `ImageFont` / `ImageDraw.text` 等价物）。
 *
 * 这一层是 `AGENTS.md` §7「文字度量与字形栅格化差异」的正面解法（施工说明 §8 风险 1）：
 *
 * 1. **排版自己算**：所有位置来自整数网格 `x = x0 + col * cw`，
 *    **不依赖字体度量做布局决策**（参考项目的确定性正来自这条纪律）。
 * 2. **烤字形图集**：启动时把用到的字符渲进一张位图，之后逐帧只 `drawImage` blit。
 *    - 渲染结果被**冻结** → 跨机器一致（同一个 Skia 版本内）
 *    - 比每帧 `fillText` 快一个量级
 *    - 绕开 canvas 文字度量与 PIL 的差异
 *
 * ⚠️ 残留风险：字形**形状**本身仍与 PIL 不同（FreeType vs Skia）。
 * 这属于「换渲染器必然的观感变化」，不是 bug（施工说明 §8 风险 1 末）。
 *
 * 字体来源：**不往仓库里放字体文件**（`design-options.md` §1.11 的 T1：
 * 不分发字体，dsh 自己也是用系统字体栈）。所以这里解析的是**系统字体**，
 * 并且在解析不到时**大声报错**，而不是静默回退到一个难看的默认字体。
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';

import { createLayer, ctx2d } from './canvas.js';
import { bbox } from './raster.js';
import { readRaw } from './raster.js';

export { GlobalFonts, loadImage };

/**
 * 系统字体目录（按平台）。
 * `AGENTS.md` §7 与施工说明附录 D：**不要硬编码 `C:/Windows/Fonts/...` 到调用点**，
 * 集中在这里，并留环境变量兜底（参考项目 `v2.py:356` 就是写死的，别学）。
 * @returns {string[]}
 */
export function fontDirs() {
  const fromEnv = process.env.DSH_FONT_DIR;
  const out = [];
  if (fromEnv) out.push(fromEnv);
  if (process.platform === 'win32') {
    const win = process.env.WINDIR ?? 'C:\\Windows';
    out.push(join(win, 'Fonts'));
    out.push('C:\\Windows\\Fonts');
  } else if (process.platform === 'darwin') {
    out.push('/System/Library/Fonts', '/Library/Fonts', join(process.env.HOME ?? '', 'Library/Fonts'));
  } else {
    out.push('/usr/share/fonts', '/usr/local/share/fonts', join(process.env.HOME ?? '', '.fonts'));
  }
  return [...new Set(out)];
}

/**
 * 解析一个系统字体文件的**绝对路径**。
 * @param {string|string[]} names 候选文件名，按优先级（如 `['consola.ttf']`）
 * @param {?string} [explicit] 显式路径（优先）
 * @returns {string} 绝对路径
 * @throws {Error} 都找不到时抛出，并列出找过的地方
 */
export function resolveFontFile(names, explicit = null) {
  const list = Array.isArray(names) ? names : [names];
  if (explicit) {
    if (isFile(explicit)) return explicit;
    throw new Error(`字体文件不存在：${explicit}`);
  }
  const dirs = fontDirs();
  for (const name of list) {
    // 允许直接把绝对路径塞进候选列表（--font 场景）
    if (name.includes('\\') || name.includes('/')) {
      if (isFile(name)) return name;
      continue;
    }
    for (const dir of dirs) {
      const p = join(dir, name);
      if (isFile(p)) return p;
    }
  }
  throw new Error(
    `找不到字体（找过 ${list.join(' / ')}）\n` +
      `  目录：${dirs.join(' | ')}\n` +
      `  hint: 设 $env:DSH_FONT_DIR=<字体目录>，或用 --font <绝对路径>` +
      `（**不往仓库里放字体文件**，见 design-options §1.11）`,
  );
}

/** @param {string} p */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @typedef {Object} RegisteredFont
 * @property {string} key 注册名（给 `ctx.font = '<size>px <key>'` 用）
 * @property {string} path 文件绝对路径
 * @property {string} family 该字体本身的 family 名（诊断用）
 * @property {number} size 请求的字号
 */

/**
 * 注册一个字体文件（幂等：同一个 `(path, size)` 只注册一次）。
 *
 * @napi-rs/canvas 的 `GlobalFonts.registerFromPath(path, alias)` 是**进程级**注册，
 * 所以要给每个字号一个不同的别名，否则后注册的字号会把前一个覆盖掉。
 * @param {string} path
 * @param {number} size 字号（px）
 * @param {string} [aliasPrefix]
 * @returns {RegisteredFont}
 */
export function registerFont(path, size, aliasPrefix = 'dsh') {
  const abs = path;
  const key = `${aliasPrefix}-${size}-${hashKey(abs)}`;
  if (registered.has(key)) return /** @type {RegisteredFont} */ (registered.get(key));
  const ok = GlobalFonts.registerFromPath(abs, key);
  if (!ok) {
    throw new Error(
      `字体注册失败：${abs}\n` +
        `  hint: 这个文件可能不是 ttf/otf/ttc（.ttc 需要 index，@napi-rs/canvas 会取第 0 个）`,
    );
  }
  /** @type {RegisteredFont} */
  const rec = { key, path: abs, family: GlobalFonts.families.find((f) => f.family === key)?.family ?? key, size };
  registered.set(key, rec);
  return rec;
}

/** @type {Map<string, RegisteredFont>} */
const registered = new Map();

/** @param {string} s */
function hashKey(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).slice(0, 8);
}

/**
 * @typedef {Object} Glyph
 * @property {number} col 图集里的列
 * @property {number} row 图集里的行
 * @property {number} advance 步进宽（整数；等宽网格模式下就是单元格宽度）
 * @property {number} measured 该字符**自己**的步进（`measureText`，非等宽字体下与 `advance` 不同）
 * @property {number} xOff 墨迹左上角相对**基线格左上角**的 x 偏移
 * @property {number} yOff 墨迹左上角相对**基线格左上角**的 y 偏移（负值 = 在基线之上）
 * @property {number} w 墨迹宽
 * @property {number} h 墨迹高
 * @property {boolean} blank 是不是空字形（空格、或者是缺字形且不可见）
 */

/**
 * @typedef {Object} GlyphAtlas
 * @property {import('@napi-rs/canvas').Canvas} canvas 图集位图（RGBA）
 * @property {string} fontKey 注册名
 * @property {number} size 字号
 * @property {Map<string, Glyph>} glyphs
 * @property {number} cellW 单元格宽（= advance）
 * @property {number} cellH 单元格高（= 行高，整数）
 * @property {number} ascent 基线相对单元格顶的偏移
 * @property {number} cols @property {number} rows
 * @property {number} atlasW @property {number} atlasH
 */

/**
 * 烤一张字形图集（对应「启动时把用到的字符渲进一张位图」）。
 *
 * 做法：给定 `chars`，去重后按行优先排进一个**整数网格**；每个字符单独渲到
 * 一格上，再用 `bbox()` 量出它的**墨迹**范围，存成与基线相对的偏移。
 * 逐帧绘制时只做 `drawImage(atlas.canvas, sx,sy,sw,sh, dx,dy,w,h)`。
 *
 * 关于 `advance`：用 `measureText('M').width` 取整。
 * ⚠️ 对**比例字体**（如微软雅黑）这只是一个近似 —— 所以本函数给的是**等宽网格**语义。
 * 中文排版要按 `design-options.md` §1.11 的系数另算（`cjkScale`）。
 * @param {RegisteredFont} font
 * @param {string} chars 需要的字符（重复会自动去掉）
 * @param {{cellW?: number, pad?: number}} [opts]
 * @returns {GlyphAtlas}
 */
export function glyphAtlas(font, chars, opts = {}) {
  const size = font.size;
  const pad = opts.pad ?? 1;
  const list = [...new Set([...chars])].filter((c) => c !== '\n' && c !== '\r');

  // 量一个参考字符的步进（等宽字体下就是所有字的步进）
  const probe = createCanvas(size * 4 + 8, size * 4 + 8);
  const pctx = ctx2d(probe);
  pctx.font = `${size}px ${font.key}`;
  const advance = Math.ceil(pctx.measureText('M').width);
  const cellW = opts.cellW ?? advance;
  if (cellW <= 0) throw new Error(`glyphAtlas: cellW 算出来是 ${cellW}，字号 ${size} 太小`);

  // 行高：用 'Ag' 的墨迹高度 + 上下留白，全部整数
  const metrics = pctx.measureText('Ag');
  const inkH = Math.ceil((metrics.actualBoundingBoxAscent ?? size * 0.8) + (metrics.actualBoundingBoxDescent ?? size * 0.2));
  const cellH = Math.max(size, inkH + pad * 2);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent ?? size * 0.8);

  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  const rows = Math.max(1, Math.ceil(list.length / cols));
  const atlasW = cols * cellW;
  const atlasH = rows * cellH;
  const atlas = createLayer(atlasW, atlasH);
  const actx = ctx2d(atlas);
  actx.font = `${size}px ${font.key}`;
  actx.textBaseline = 'alphabetic';
  actx.fillStyle = '#ffffff';

  // 每格：把字符画在该格基线上（格子左缘 + 0，基线 = 格顶 + ascent）
  /** @type {Map<string, Glyph>} */
  const glyphs = new Map();
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const baseline = y0 + ascent;
    actx.fillText(ch, x0, baseline);

    // 量墨迹：只在这一格范围内找，避免相邻格串味
    const cell = readRaw(atlas);
    const ink = bbox(cell, {
      x0,
      y0,
      x1: Math.min(atlasW - 1, x0 + cellW - 1),
      y1: Math.min(atlasH - 1, y0 + cellH - 1),
    });
    const measured = Math.ceil(actx.measureText(ch).width);
    if (!ink) {
      glyphs.set(ch, { col, row, advance, measured, xOff: 0, yOff: 0, w: 0, h: 0, blank: true });
      continue;
    }
    glyphs.set(ch, {
      col,
      row,
      advance,
      measured,
      xOff: ink.x0 - x0,
      yOff: ink.y0 - baseline,
      w: ink.x1 - ink.x0,
      h: ink.y1 - ink.y0,
      blank: false,
    });
  }

  return {
    canvas: atlas,
    fontKey: font.key,
    size,
    glyphs,
    cellW,
    cellH,
    ascent,
    cols,
    rows,
    atlasW,
    atlasH,
  };
}

/**
 * 字体的格子度量（对应施工说明 §5.3 的 `cellMetrics(style)`）。
 *
 * **不要**用它去「自动折行」—— 排版是调用方按整数网格算的（`col * cellW`）。
 * 它只回答「一格多宽多高、基线在哪」。
 * @param {GlyphAtlas} atlas
 * @returns {{w: number, h: number, ascent: number, size: number}}
 */
export function cellMetrics(atlas) {
  return { w: atlas.cellW, h: atlas.cellH, ascent: atlas.ascent, size: atlas.size };
}

/**
 * 按整数网格画一行文字（图集 blit 版）。
 *
 * **这是 `content/` 该用的那个**：位置全由整数决定，不调 `measureText`。
 * 缺字形（图集里没有）会**记账并继续**，不静默变豆腐块 —— 调用方随后可以
 * `atlas.glyphs.has(ch)` 自查，或让 `onMissing` 抛。
 *
 * 两种步进模式（`opts.mono`）：
 * - **`mono: true`（默认）**：每个字符固定占 `cellW`，位置就是 `col * cellW`。
 *   最确定的模式，**等宽文本必须用它**（这也是参考项目像素级确定性的来源）。
 * - **`mono: false`**：按每个字形**自己**的 `measured` 步进推进。
 *   ⚠️ 这是给**混排**（中文 + 拉丁 + 空格）用的：中文是全角、拉丁是半角，
 *   用等宽格会得到「P V 画 面」这种被撑开的观感。
 *   它仍然只用图集（渲染结果被冻结），只是前进量不同。
 *
 * @param {any} dst 目标 canvas
 * @param {GlyphAtlas} atlas
 * @param {{x?: number, y?: number, col?: number, row?: number}} pos
 *   `x`/`y` 是**基线格的左上角**（不是基线），基线在 `y + cellMetrics(atlas).ascent`
 * @param {string} str
 * @param {{color?: string, alpha?: number, mono?: boolean, onMissing?: 'skip'|'throw'|'warn'}} [opts]
 * @returns {{missing: string[], drawn: number, width: number}}
 */
export function drawText(dst, atlas, pos, str, opts = {}) {
  const ctx = ctx2d(dst);
  const onMissing = opts.onMissing ?? 'warn';
  const mono = opts.mono ?? true;
  const x0 = pos.x ?? 0;
  const y0 = pos.y ?? 0;
  const color = opts.color ?? '#ffffff';

  const tint = tintAtlas(atlas, color);
  ctx.globalAlpha = opts.alpha ?? 1;

  /** @type {string[]} */
  const missing = [];
  let drawn = 0;
  let pen = x0;
  for (const ch of str) {
    const g = atlas.glyphs.get(ch);
    if (!g) {
      missing.push(ch);
      if (onMissing === 'throw') {
        throw new Error(
          `drawText: 图集里没有字形 ${JSON.stringify(ch)}（字号 ${atlas.size}）\n` +
            `  hint: 烤图集时把用到的字符集给它；🈚️ 缺字形不要静默画成豆腐块`,
        );
      }
      pen += mono ? atlas.cellW : 0;
      continue;
    }
    if (!g.blank) {
      ctx.drawImage(
        tint,
        g.col * atlas.cellW,
        g.row * atlas.cellH,
        atlas.cellW,
        atlas.cellH,
        pen + g.xOff,
        y0 + g.yOff + atlas.ascent,
        g.w,
        g.h,
      );
      drawn++;
    }
    pen += mono ? atlas.cellW : g.measured;
  }
  ctx.globalAlpha = 1;
  if (missing.length && onMissing === 'warn') {
    console.warn(`drawText: 缺 ${missing.length} 个字形：${[...new Set(missing)].join('')}`);
  }
  return { missing, drawn, width: pen - x0 };
}

/**
 * 把图集整体染成目标颜色，返回可 blit 的图集（逐格 blit 时不用再管颜色）。
 *
 * 缓存键是 `(色, 图集尺寸)`，键空间有限（颜色数 × 图集数），**不需要**有界缓存。
 * @param {GlyphAtlas} atlas
 * @param {string} color
 * @returns {import('@napi-rs/canvas').Canvas}
 */
function tintAtlas(atlas, color) {
  const key = `${color}|${atlas.atlasW}x${atlas.atlasH}|${atlas.fontKey}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const canvas = createLayer(atlas.atlasW, atlas.atlasH);
  const c = ctx2d(canvas);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.drawImage(atlas.canvas, 0, 0);
  // 'source-in' 只保留与填充区域重叠的部分，于是整张图集被染成同一个颜色
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, atlas.atlasW, atlas.atlasH);
  c.globalCompositeOperation = 'source-over';
  tintCache.set(key, canvas);
  return canvas;
}

/** @type {Map<string, any>} */
const tintCache = new Map();

/**
 * 直接用 `fillText` 画（**不走**图集）。
 *
 * 用途：只在**一次性**的调试图、或字号/字符集事先无法枚举时用。
 * 逐帧路径**不要**用它 —— 那就放弃了「冻结渲染结果」，也没法保证同帧双渲一致。
 * @param {any} dst
 * @param {{fontKey: string, size: number}} font
 * @param {number} x @param {number} y 基线坐标
 * @param {string} str
 * @param {{color?: string, alpha?: number}} [opts]
 * @returns {number} 前进宽度（`measureText().width`；**不作为布局依据**）
 */
export function drawTextDirect(dst, font, x, y, str, opts = {}) {
  const ctx = ctx2d(dst);
  ctx.font = `${font.size}px ${font.fontKey}`;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
  return ctx.measureText(str).width;
}

/**
 * 中文缩放系数（`design-options.md` §1.11）。
 *
 * ```
 * 需要的汉字步进 = 2 × 拉丁格宽
 * 系数 = 2 × (拉丁步进 / 字号)      ← 与具体中文字体无关（只要汉字步进是 1 em）
 * Consolas：2 × (35/64) = 1.09375
 * ```
 *
 * ⚠️ 本人指定这一条**只用于我们自己的网格，不用于 dsh UI**
 * （dsh 的等宽栈里本来就没有等宽中文字体，它自己也错位）—— 见 §1.12 的两条推论。
 * @param {number} latinAdvance 拉丁步进（像素）
 * @param {number} size 字号（像素）
 * @returns {number}
 */
export function cjkScale(latinAdvance, size) {
  return 2 * (latinAdvance / size);
}

/**
 * 按 `cjkScale` 算出中文该用的字号（整数）。
 * @param {number} monoSize 拉丁字号
 * @param {number} scale
 * @returns {number}
 */
export function cjkPointSize(monoSize, scale) {
  return Math.round(monoSize * scale);
}

/**
 * 解析「我们的世界」用的那对字体（`design-options.md` §1.11 T1）：
 * 拉丁 = **Consolas**，中文 = **Microsoft YaHei**。
 * @param {{monoSize: number, cjkSize?: number, monoPath?: ?string, cjkPath?: ?string, cjkIndex?: number}} opts
 * @returns {{mono: RegisteredFont, cjk: RegisteredFont, monoPath: string, cjkPath: string}}
 */
export function resolveWorldFonts(opts) {
  const monoPath = resolveFontFile(['consola.ttf', 'Consolas.ttf'], opts.monoPath ?? process.env.DSH_FONT_MONO ?? null);
  const cjkPath = resolveFontFile(['msyh.ttc', 'msyh.ttf', 'MicrosoftYaHei.ttf'], opts.cjkPath ?? process.env.DSH_FONT_CJK ?? null);
  const mono = registerFont(monoPath, opts.monoSize, 'dsh-mono');
  const cjkSize = opts.cjkSize ?? cjkPointSize(opts.monoSize, 1.09375);
  const cjk = registerFont(cjkPath, cjkSize, 'dsh-cjk');
  return { mono, cjk, monoPath, cjkPath };
}
