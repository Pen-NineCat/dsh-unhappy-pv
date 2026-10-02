/**
 * film/content/cursor.js — 把**她**（那只鼠标箭头）画出来。位置与形状来自 `film/engine/cursor.js`。
 *
 * ## 三种形状是**我们自己画的**，尺寸是量出来的
 *
 * 画面规格 §三：**遵循鼠标箭头的一切** —— 形状随所在控件变化（界面上是箭头、
 * **输入框上是 I-beam**、可点处是手型）。所以这里不去"设计"一个图标，而是复刻
 * **这台机器上真鼠标**的形状与大小。量的办法与结论：
 *
 * | 形状 | 尺寸 | 依据 |
 * |---|---|---|
 * | 箭头 | **12 × 19 px**（墨迹外接框） | 实测本机 `aero_arrow.cur` 的 32×32 那一帧：墨迹 `x 0..11 / y 0..18`，白填充 + 深色描边（255,255,255）/（14,1,0） |
 * | I-beam | 7 × 16 px | Windows 文本光标的惯用尺寸（这台机器的 `beam_r.cur` 是**1bpp 单色**条目，读不出可靠的外接框 —— 这条是"惯例"而不是"实测"，如实标注） |
 * | 手型 | 11 × 21 px | 实测本机 `aero_link.cur`：墨迹 18×24，指尖在 (5,0)。我按同一比例画了一个自己的多边形（**不复刻微软的位图**，规则 9） |
 *
 * ⚠️ **手型这一版没有任何一帧用到**（T5 里她只在输入框与对话区之间移动，形状只出现
 * `ibeam` / `arrow`）。所以它是**未经人眼确认**的：`film/test/probe-t5.mjs --shapes`
 * 会把三种形状各放大 8 倍出一张图，供作者顺手看一眼。
 *
 * ## 画在哪一层：`chrome`（最上面那层）—— 与参考项目同构
 *
 * 作者 2026-10-01 让我去查参考项目怎么处理这件事（A3）。查的结果是**两条**：
 *
 * 1. **dsh 截图进的是"角色层"**。`world-execute-me-dsh-pv/docs/HOW_IT_WORKS.md:19`：
 *    「右边原来画"她"的窗格（`kit.her_layer`、`me_pane`），**换成这一帧的 dsh 截图**。
 *    所以右边镜头对她做的推拉、隔离、滑出，都直接作用在这个窗口上。」
 *    → 我们用 `film/compose/track-layer.js` 把截图贴进 `subject`（第 4 层），**同一条路**。
 * 2. **"她"身上那些必须压在她上面的东西，走一个独立的 OVERLAY 槽**。
 *    `continuity_full_v2/v2.py:286-293` 的单帧合成顺序是：
 *
 *    ```
 *    fr.content  →  her layer（角色层，可推拉/滑出）  →  OVERLAY（注释原文："drawn over her"）
 *                →  fr.over  →  kit.chrome（最后）  →  engine.post
 *    ```
 *
 *    而**参考项目那个鼠标是"画两处"的**（`dsh_patch_mem.py:31`：
 *    「Drawn in two places: `kit.her_layer` … and `v2.OVERLAY`」）——
 *    因为它那张 her layer 会跟着窗格滑走，只画一处就会被裁掉。
 *
 * **所以参考项目的答案是"角色层 + 一个专门压在角色层之上的槽"**，而 `chrome` 永远最后。
 * 我们的六层顺序（`AGENTS.md` §7，不可变）里，`chrome` 就是**唯一**那个槽：
 * `compose()` 按 `LAYERS` 顺序合成，`chrome` 永远盖在 `subject` 之上 ——
 * 而且**与绘制时刻无关**（语段函数在 track-layer 之前跑，chrome 的像素照样在最上面）。
 * 于是她在 `chrome` 里**最后**画，就同时满足三件事：
 *
 * 1. 压在**两个面板**之上（`content/act1.js` 里的调用顺序）；
 * 2. 压在**左格那张网页截图**之上（它在 `subject` 里）；
 * 3. 不需要给引擎加第 7 层、也不需要改 `AGENTS.md` §7 的六层顺序。
 *
 * 📌 **与她画两处的那种做法的差别**：参考项目要画两处，是因为它那张 her layer 会被镜头
 * **滑走/裁剪**；我们的角色层装的是 dsh 截图，而**她本人在任何一段里都不跟格子一起被变换**
 * （三级拉远都是"窗口真的在变小 / 版图真的在换"，不是对某一层做位图变换）。
 * 等哪一天她的位置真要被镜头推动（比如第二次合唱后的合并），**那时**再把她挪进 `subject`
 * 并在"贴完截图之后"补一个绘制点 —— 那是一处显式改动，不是猴补丁（规则 12）。
 *
 * 另外：**引子（0–419）里没有她**（§2.1 的画面清单里没有鼠标），所以 `drawCursor` 在那些帧
 * 一个像素都不画。
 *
 * 纪律（`AGENTS.md` §2 规则 12）：只调 `film/kit/` 与 `film/engine/` 的接口；
 * 文字不走这里（她身上没有字），所以不涉及字形图集。
 */

import { ctx2d } from '../kit/canvas.js';
import { cursorAt } from '../engine/cursor.js';

/**
 * 尺寸倍率。**1 = 与真鼠标同大**（1920×1080 的片子上就是 1:1 的实机尺寸 ——
 * 片子原生就是那个分辨率，所以"同大"是字面意义上的同大）。
 * 要"看得更清楚"就调这一个数（2 就是 200% 光标）。
 */
export const CURSOR_SCALE = 1;

/** 填充色 = 真鼠标的填充色（实测 `255,255,255`）。 */
export const CURSOR_FILL = '#ffffff';

/** 描边色 = 真鼠标的描边色（实测 `14,1,0`，就是黑）。 */
export const CURSOR_STROKE = '#000000';

/**
 * **箭头**：12×19（实测外接框），尖端 = 热区 = 多边形的 (0,0)。
 *
 * 逐点对照实测位图：左边缘从尖端竖直向下到 (0,16)（实测 x=0 那一列到 y=16）；
 * 上右斜边 (0,0)→(11,11)（实测 y=11 那一行最宽，x=0..11）；
 * 下缘 (11,11)→(6,12)（实测 y=12 那一行 x7..11 是描边色）；
 * 尾巴 (6,12)→(9,17)→(7,18)→(4,12)（实测尾巴在 y14–18 的一小条）；
 * (4,12)→(0,16) 收回到左下角。
 * @type {readonly (readonly [number, number])[]}
 */
const ARROW = [
  [0, 0],
  [0, 16],
  [4, 12],
  [7, 18],
  [9, 17],
  [6, 12],
  [11, 11],
];

/**
 * **I-beam**：7×16，热区在正中（(0,0) 就是竖笔画的中心）。
 * 一个闭合多边形（上横、下横、中间竖笔），所以描边只画外轮廓。
 * @type {readonly (readonly [number, number])[]}
 */
const IBEAM = [
  [-3, -8],
  [3, -8],
  [3, -6],
  [1, -6],
  [1, 6],
  [3, 6],
  [3, 8],
  [-3, 8],
  [-3, 6],
  [-1, 6],
  [-1, -6],
  [-3, -6],
];

/**
 * **手型**：11×21，尖端 = 热区 = (0,0)。照着实测的 `aero_link`（食指尖朝上、
 * 另外三指在右、掌在左下）**自己画的多边形** —— 形状相似就够，不复刻位图。
 * @type {readonly (readonly [number, number])[]}
 */
const HAND = [
  [0, 0],
  [4, 0],
  [4, 5],
  [6, 4],
  [6, 9],
  [8, 8],
  [8, 12],
  [10, 11],
  [10, 17],
  [8, 20],
  [2, 20],
  [0, 17],
  [0, 5],
];

/** 三种形状的顶点表（`shape` 的名字与 `engine/cursor.js` 的返回值一致）。 */
export const CURSOR_SHAPES = { arrow: ARROW, ibeam: IBEAM, hand: HAND };

/**
 * 把一个形状画到目标画布上（填充 + 描边，= 真鼠标的两个颜色）。
 *
 * `x`/`y` 是**热区**（箭头与手型是尖端、I-beam 是正中心），整数或小数都可以
 * （Skia 会抗锯齿；同一版本内是确定的，`⭐ 同帧双渲`照常成立）。
 * @param {any} target 画布或 ctx
 * @param {'arrow'|'ibeam'|'hand'} shape
 * @param {number} x @param {number} y 热区坐标（帧坐标，px）
 * @param {{scale?: number, fill?: string, stroke?: string, alpha?: number}} [opts]
 * @returns {{points: number, w: number, h: number}} 顺带报一下外接框（测试与探针用）
 */
export function drawCursorShape(target, shape, x, y, opts = {}) {
  const pts = CURSOR_SHAPES[shape];
  if (!pts) {
    throw new Error(
      `drawCursorShape: 没有叫 "${shape}" 的形状\n  hint: 可用形状：${Object.keys(CURSOR_SHAPES).join(' / ')}`,
    );
  }
  const k = opts.scale ?? CURSOR_SCALE;
  const ctx = ctx2d(target);
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.beginPath();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pts.forEach(([px, py], i) => {
    const cx = x + px * k;
    const cy = y + py * k;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
  });
  ctx.closePath();
  ctx.fillStyle = opts.fill ?? CURSOR_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, k);
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = opts.stroke ?? CURSOR_STROKE;
  ctx.stroke();
  ctx.restore();
  return { points: pts.length, w: maxX - minX, h: maxY - minY };
}

/**
 * 第 `s.n` 帧：把她画进画面（不可见的那一帧什么都不做）。
 *
 * 画在 `chrome`（最上面那层）—— 为什么见文件头。
 * @param {import('../engine/frame.js').FrameState} s
 * @returns {?import('../engine/cursor.js').CursorState} 画了的话返回她的状态（探针/测试用）
 */
export function drawCursor(s) {
  const c = cursorAt(s.n);
  if (!c.visible) return null;
  drawCursorShape(s.stack.chrome, c.shape, c.x, c.y);
  return c;
}
