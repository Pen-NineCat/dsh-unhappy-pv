/**
 * film/content/act1.js — **第一幕 `[419, 1903)` 的画布侧**（把这一段的几件东西装到一起）。
 *
 * 与 `content/prelude.js` 同构：那一个是引子的画布侧（占位背景 + 骨架），
 * 这一个是第一幕的（骨架 + memory 的记录 + **她**）。
 * ⚠️ 名字与 `film/pages/act1.js` 撞了，**这是有意的**：那两个文件是同一幕的两侧
 * （`pages/` 是浏览器世界＝他；`content/` 是画布世界＝不是他的东西）。
 *
 * ## 顺序就是 z 序（六层里的每一层内部，后画的在上面）
 *
 * | 层 | 谁画 | 备注 |
 * |---|---|---|
 * | `chrome` | `drawPanels` → `drawMemory` → **`drawCursor`** | 最上面那层；她**最后**画 ⇒ 她压在两格与左格截图之上 |
 * | `subject` | `film/compose/track-layer.js` | 左格那张 dsh UI 截图（在语段函数**之后**贴进来） |
 *
 * ⚠️ **她必须在 `chrome` 里最后画**，不能画进 `subject`：
 * 截图会把 `subject` 整个 `clearRect` 再贴上去（见 `film/content/cursor.js` 文件头的三条理由）。
 *
 * ## 这一版还没做的（都是 T5 之外的段）
 *
 * 右上格（`terminal` / 网络结构）**还是空的** —— 四条日志属于 T8（`[1217,1560)`）、
 * 层堆叠属于 T6/T7。所以第一幕现在能看到的只有：三格骨架、memory 的两条记录、以及她。
 */

import { drawCursor } from './cursor.js';
import { drawMemory } from './memory.js';
import { drawPanels } from './panels.js';

/**
 * 画第一幕的一帧。
 * @param {import('../engine/frame.js').FrameState} s
 * @returns {{rows: number}} memory 这一帧有几条记录（探针与测试用）
 */
export function drawAct1(s) {
  drawPanels(s);
  const m = drawMemory(s);
  drawCursor(s);
  return m;
}
