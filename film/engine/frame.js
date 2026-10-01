/**
 * film/engine/frame.js — 单帧入口 `frame(n, prev = null)`（施工说明 §5.1 的**死规则**）。
 *
 * ```
 * frame(n, prev = null) -> Canvas   // 尺寸恒为 (W, H)，像素格式恒为 RGB（无 alpha）
 * ```
 *
 * 死规则（`AGENTS.md` §2 规则 5/6/7）
 * --------------------------------
 * 1. **纯函数**：同一 `(n, prev)` 必须得到同一结果。
 * 2. **跨帧状态只能通过 `prev` 传入**，不能藏在模块级变量里。
 * 3. **禁止 `Math.random()`**：随机一律走 `frameRng(seed, n)`。
 * 4. `frame` **不知道自己被并行渲染**：worker 从自己的 `n0` 起跑时 `prev = null`，
 *    这是调用方的责任（施工说明 §5.4 第 2 条）。
 *
 * 这一层只负责**编排**（建层 → 按时间线跑语段 → 合成 → 后期），不画任何具体内容。
 * 场景代码在 `film/content/`，而且只许调 `film/kit/` 的接口（`AGENTS.md` §2 规则 12）。
 *
 * 说明：`prev` 的契约
 * ------------------
 * `prev` 是**上一帧渲染出来的 canvas**（不是 buffer）。原因是本帧末尾要做的后期
 * （残影等等）需要**上一帧的像素**，而 canvas 自带尺寸 —— 反过来如果把 buffer 传进来，
 * 4K 与 1080p 的 buffer 长度不同，混用就会静默画错。
 * 传进来的尺寸不对会**当场报错**，不会静默降级。
 */

import { FPS, H, W, frameAt } from './clock.js';
import { buildTimeline } from './content.js';
import { compose, makeStack } from './layers.js';
import { list as listSegments } from './timeline.js';
import { createOpaque } from '../kit/canvas.js';
import { post } from '../kit/post.js';
import { mergeConfig } from '../kit/post-config.js';

/**
 * @typedef {Object} FrameState
 * @property {number} n 帧号
 * @property {number} t 该帧的绝对时间（秒）= `n / FPS`
 * @property {import('./layers.js').LayerStack} stack 六层
 * @property {?import('@napi-rs/canvas').Canvas} prev 上一帧（调用方给；`null` 表示「这段的第一帧」）
 * @property {import('../kit/post-config.js').PostConfig} postCfg 后期参数（唯一来源是 `kit/post-config.js`）
 * @property {{trail?: boolean, bloom?: boolean, scanlines?: boolean, vignette?: boolean}} [postEnable]
 * @property {FrameOptions['trackLayers']} [trackLayers] 轨道层注入器（Phase 6，可选）
 */

/**
 * 这一帧落在哪个语段里。
 *
 * 时间线的 ⭐ 断言保证语段首尾相接、无空洞无重叠，所以一帧**最多**落进一段。
 * 落在 `[0, END_T)` 之外（越界帧）返回 `null` —— 由调用方决定是报错还是画空。
 * @param {number} t
 * @returns {?import('./timeline.js').Segment}
 */
function segmentFor(t) {
  for (const s of listSegments()) {
    if (t >= s.start && t < s.end) return s;
  }
  return null;
}

/**
 * 单帧渲染的可选项。
 * @typedef {Object} FrameOptions
 * @property {import('../kit/post-config.js').PostConfig} [post] 后期参数（默认 `DEFAULTS`）
 * @property {{trail?: boolean, bloom?: boolean, scanlines?: boolean, vignette?: boolean}} [postEnable]
 *   逐项开关；`--no-post` 就是「四个都关」
 * @property {?((stack: import('./layers.js').LayerStack, ctx: {n: number, t: number}) => Promise<void>|void)} [trackLayers]
 *   **可选**的轨道层注入器（Phase 6）。引擎**不 import** `film/compose/`、不 import playwright ——
 *   它只认这个函数参数，所以「关掉网页层还能渲」这件事是天然成立的。
 *   由 `film/compose/track-layer.js` 的 `makeTrackLayerFn()` 生产。
 */

/**
 * 渲染一帧。
 *
 * 异步版本：`trackLayers` 可能要读截图（磁盘 IO）。没有 `trackLayers` 时它就是同步的
 * （`renderFrame` 是同步包装，给不需要轨道层的调用方用）。
 *
 * @param {number} n 帧号，`n = Math.round(t * FPS)`
 * @param {?import('@napi-rs/canvas').Canvas} prev 上一帧（残影/运动模糊用）；无则 `null`
 * @param {FrameOptions} [opts]
 * @returns {Promise<import('@napi-rs/canvas').Canvas>} 合成结果，尺寸恒为 `(W, H)`
 */
export async function frameAsync(n, prev = null, opts = {}) {
  assertFrameArgs(n, prev);

  // t 只由 clock 的 FPS 换算，不在这里写第二套换算
  const t = n / FPS;

  // 时间线在这里**惰性建一次**（幂等，已 memo）：引擎不 import 具体场景，
  // 只查登记好的表。换一段内容 = 改 engine/content.js 这一个文件。
  buildTimeline();

  const stack = makeStack(n, W, H);

  /** 第 6 层：`post` 需要 `prev`，所以不在 `LAYERS` 里，是最后单独一步（施工说明 §5.2）。 */
  const postCfg = opts.post ?? mergeConfig();
  /** @type {FrameState} */
  const state = { n, t, stack, prev, postCfg, postEnable: opts.postEnable, trackLayers: opts.trackLayers };

  const seg = segmentFor(t);
  if (seg) await seg.fn(state);

  // Phase 6：把网页截图贴进第 4 层。**在语段画完之后**（以免被 content 覆盖），
  // **在合成之前**（这样六层顺序与后期都照旧生效）。
  if (opts.trackLayers) await opts.trackLayers(stack, { n, t });

  // 六层从下到上合成进一张不透明底
  const composed = compose(createOpaque(W, H, '#000000'), stack);

  // 第 6 层：后期四件套（残影 → 辉光 → 扫描线 → 暗角）
  post(composed, prev, postCfg, opts.postEnable);

  return composed;
}

/**
 * 渲染一帧（同步版）：**不**支持 `trackLayers`。
 *
 * 保留它是因为绝大多数调用点（单帧抽查、护栏、`--no-post` 排障、Phase 3 的自检内容）
 * 都不需要读截图；让它们继续是同步的，错误更早暴露、栈更短。
 * @param {number} n
 * @param {?import('@napi-rs/canvas').Canvas} prev
 * @param {Omit<FrameOptions, 'trackLayers'>} [opts]
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export function frame(n, prev = null, opts = {}) {
  assertFrameArgs(n, prev);
  if (/** @type {any} */ (opts).trackLayers) {
    throw new Error(
      'frame() 是同步的，不支持 trackLayers\n' +
        '  hint: 有轨道层时请用 frameAsync()（它要 await 读截图）',
    );
  }

  const t = n / FPS;
  buildTimeline();
  const stack = makeStack(n, W, H);
  const postCfg = opts.post ?? mergeConfig();

  const seg = segmentFor(t);
  if (seg) {
    /** @type {FrameState} */
    const state = { n, t, stack, prev, postCfg, postEnable: opts.postEnable };
    seg.fn(state);
  }

  const composed = compose(createOpaque(W, H, '#000000'), stack);
  post(composed, prev, postCfg, opts.postEnable);
  return composed;
}

/**
 * `frame()` 与 `frameAsync()` 共用的入参断言。
 * @param {number} n @param {?any} prev
 */
function assertFrameArgs(n, prev) {
  if (!Number.isInteger(n)) {
    throw new Error(`frame(n): n 必须是整数帧号（n = Math.round(t * FPS)），收到 ${n}`);
  }
  if (prev) {
    // 尺寸不对就当场报错 —— 混用不同尺寸的 prev 是静默画错的经典来源
    const pw = prev.width ?? prev.canvas?.width;
    const ph = prev.height ?? prev.canvas?.height;
    if (pw !== W || ph !== H) {
      throw new Error(
        `frame(${n}): prev 尺寸 ${pw}×${ph} 与画布 ${W}×${H} 不一致\n` +
          `  hint: prev 必须是上一帧**本管线**渲染出来的 canvas；换分辨率时不能沿用旧的 prev`,
      );
    }
  }
}

/**
 * 名字更明确的别名：**这是「画一帧」，不是「画一段」**。
 * `film/render.js` 与 worker 都用它。
 * @param {number} n
 * @param {?import('@napi-rs/canvas').Canvas} [prev]
 * @param {FrameOptions} [opts]
 */
export function renderFrame(n, prev = null, opts = {}) {
  return frame(n, prev, opts);
}

export { FPS, H, W, frameAt };
