/**
 * film/kit/post-config.js — **后期参数的唯一来源**（施工说明 §6 Phase 4 验收最后一条：
 * 「后期参数（trail/bloom/sigma）集中在一处，可命令行覆盖」）。
 *
 * 纪律：`content/`、`engine/`、CLI 都**不许再写死**这些数字，一律从这里取。
 * 覆盖方式（优先级从低到高）：`DEFAULTS` → `data/film.config.json` 里的 `post` → 环境变量 → CLI 参数。
 *
 * 为什么参数值得这么认真：后期是「一眼看出风格」的地方，而它又是**最容易被顺手写死**的地方。
 * 参考项目的教训（施工说明附录 D）：`v2.py:356` 那种写死的路径，改一次要全仓搜。
 */

/**
 * @typedef {Object} PostConfig
 * @property {number} trailAmount 残影强度 `0..1`（0 = 关）。**每多一帧衰减多少**
 * @property {number} trailFrames 残影保留多少帧（配合 `trailAmount` 做指数衰减）
 * @property {number} bloomAmount 辉光强度 `0..1`
 * @property {number} bloomSigma 辉光模糊的 sigma（在**降采样后**的图上是这个值）
 * @property {number} bloomDown 辉光降采样倍数（2 或 4；见性能基线，4 是唯一跑得动的）
 * @property {'screen'|'plus'} bloomMode `screen` 保高光不炸白（更便宜）；`plus` 是饱和加法
 * @property {number} scanlinePeriod 扫描线周期（像素，2 = 隔行）
 * @property {number} scanlineAmount 扫描线强度 `0..1`
 * @property {number} vignetteStrength 暗角强度 `0..1`
 * @property {number} vignettePower 暗角指数（越大越集中在四角）
 * @property {number} vignetteDown 暗角在多大的小图上算（宽），算完双线性放大
 * @property {'box'|'kernel'} blurMode 后期模糊走哪条路（`box` 快 4 倍，是近似；见附录 C 记录 5）
 */

/** 默认参数。**改风格改这里**。 @type {PostConfig} */
export const DEFAULTS = Object.freeze({
  trailAmount: 0.35,
  trailFrames: 3,
  bloomAmount: 0.28,
  bloomSigma: 3,
  bloomDown: 4,
  bloomMode: 'screen',
  scanlinePeriod: 3,
  scanlineAmount: 0.18,
  vignetteStrength: 0.55,
  vignettePower: 2.4,
  vignetteDown: 64,
  blurMode: 'box',
});

/**
 * 后期开关：`{ trail: true, bloom: true, scanlines: true, vignette: true }`。
 * 全关 = 快速预览用，画面只剩六层合成。
 */
export const ALL_ON = Object.freeze({ trail: true, bloom: true, scanlines: true, vignette: true });

/**
 * 把「一串覆盖来源」合成一份配置。后面的覆盖前面的。
 * @param {...(Partial<PostConfig>|null|undefined)} overlays
 * @returns {PostConfig}
 */
export function mergeConfig(...overlays) {
  /** @type {PostConfig} */
  const out = { ...DEFAULTS };
  for (const o of overlays) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null) continue;
      if (!(k in DEFAULTS)) {
        throw new Error(
          `post 配置里有未知的键 "${k}"\n  hint: 可用键：${Object.keys(DEFAULTS).join(', ')}`,
        );
      }
      // @ts-expect-error 动态赋值：键已经用 `in DEFAULTS` 校验过
      out[k] = v;
    }
  }
  return out;
}

/**
 * 从环境变量读覆盖（`DSH_POST_TRAIL_AMOUNT` 这类）。
 * 命名规则：`DSH_POST_` + 键的 SCREAMING_SNAKE 形式。
 * @returns {Partial<PostConfig>}
 */
export function envOverrides() {
  /** @type {any} */
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const envName = `DSH_POST_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
    const raw = process.env[envName];
    if (raw === undefined) continue;
    const def = /** @type {any} */ (DEFAULTS)[key];
    if (typeof def === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${envName} 要是个数，收到 "${raw}"`);
      out[key] = n;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * 把 `--post key=value,key=value` 或 `--post key=value --post key=value` 解析成覆盖对象。
 * @param {string[]} specs
 * @returns {Partial<PostConfig>}
 */
export function parseOverrides(specs) {
  /** @type {any} */
  const out = {};
  for (const spec of specs) {
    for (const pair of spec.split(',')) {
      const s = pair.trim();
      if (!s) continue;
      const eq = s.indexOf('=');
      if (eq < 0) throw new Error(`--post 的 "${s}" 不是 key=value 形式`);
      const key = s.slice(0, eq).trim();
      const raw = s.slice(eq + 1).trim();
      if (!(key in DEFAULTS)) {
        throw new Error(
          `--post 里有未知的键 "${key}"\n  hint: 可用键：${Object.keys(DEFAULTS).join(', ')}`,
        );
      }
      const def = /** @type {any} */ (DEFAULTS)[key];
      if (typeof def === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error(`--post ${key}=${raw}：要是个数`);
        out[key] = n;
      } else if (def === true || def === false) {
        out[key] = raw === 'true' || raw === '1';
      } else {
        out[key] = raw;
      }
    }
  }
  return out;
}

/**
 * 一行摘要（日志用）。
 * @param {PostConfig} cfg
 * @returns {string}
 */
export function describeConfig(cfg) {
  return (
    `trail=${cfg.trailAmount}×${cfg.trailFrames} bloom=${cfg.bloomAmount}@1/${cfg.bloomDown}` +
    `(σ${cfg.bloomSigma},${cfg.bloomMode}) scanline=${cfg.scanlineAmount}/${cfg.scanlinePeriod}` +
    ` vignette=${cfg.vignetteStrength}^${cfg.vignettePower} blur=${cfg.blurMode}`
  );
}
