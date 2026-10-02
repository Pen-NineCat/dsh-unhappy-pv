/**
 * film/pages/act1.js — **第一幕 `[419, 1903)` 的页面内容与算术**（画面规格 §2.2）。
 *
 * 与 `intro.js` 同构：这里只有纯数据与纯函数，组装 HTML 是 `body.js` 的事。
 * 两份合起来是**同一份对话文档** —— 引子写完就轮到第一幕，页面是一样的窗口，
 * 只是固定区在 419 消失（§2.1：「固定区只存在于引子」）。
 *
 * ## T5 覆盖的装置（§1.2，`[419, 802)`）
 *
 * | 时刻 | 帧 | 画面 |
 * |---|---|---|
 * | 00:17.454–00:20.114 | 419–483 | **输入框里逐字出现「我这边下雨了」，随后被逐字退格删掉**（D3）；此后零实质性输入 |
 * | 00:24.436 | 586 | 原歌词 `These feelings I have for you` 以**"不属于思考链的内容"**出现 → 被他改写成 `hmm, maybe i have state for user`；**原歌词只进 memory** |
 * | 00:26.764 | 642 | 同上：`But you don't feel the same` → `hmm, maybe user don't feel the same` |
 * | 00:29.424 / 00:31.086 | 706 / 746 | 这两句**照常走流程**：先进思维链、随后进 memory（B 规则：提前 0.5–1 s） |
 *
 * ## `D3` 定下来了（记录 31）
 *
 * 上一版这里是一段"`D3` 是悬空引用、我按三条线索猜了一句英文"的自述。
 * 新版 §2.2 把 `D3` 写全了，于是那条推测**作废**，字符串是文档给的：
 *
 * > **输入框里逐字出现「我这边下雨了」，随后被逐字退格删掉**（D3）……
 * > **内容规定**：**与歌词无关**，就是**聊聊日常**、**关于她自己的一件小事**；
 * > **没有发出去**；**必须读得出来**（1 秒左右）。
 * > **为什么她删掉它**：这种话**只有在"确定对方想听"的时候才发得出去**。
 * > 它是"话变少"的**刻度**——所以**越普通越好**
 *
 * ⚠️ 上一版我把它取成"她打的字 = 他此刻唱的那一句"（英文歌词）。那是**错的**，而且是
 * 两处错：① §1.1 的语言分工里"**人的文字是中文**"；② 这段字**与歌词无关**才是重点 ——
 * 它之所以是"刻度"，正因为它不是歌词。
 */

import { FPS } from '../engine/clock.js';
import { BLINK_HALF_FRAMES, caretOn } from './caret.js';

/** 第一幕的区间（半开；§1.2 + `AGENTS.md` §2 规则 13）。 */
export const ACT1 = { start: 419, end: 1903 };

/**
 * 输入框里那段"打了又删"的字。**字符串是文档给的**（§2.2 的 D3，见文件头）。
 * 四条内容规定都靠它体现：与歌词无关 / 关于她自己的一件小事 / 没有发出去 / 越普通越好。
 * ⚠️ 它也是 §1.1 语言分工里"**人的文字是中文**"的第一处证据（全片她的文字共两处，另一处是 `你还好吗`）。
 */
export const INPUT_TEXT = '我这边下雨了';

/**
 * 输入框的时间窗（帧，闭区间；这段是**字符进度的窗口**，不是段边界）。
 *
 * 三段分法由文档的两个时刻夹住（419 = 开词帧、483 = 下一句开口那一帧），
 * 中间怎么分是我定的，判据是那条「**必须读得出来（1 秒左右）**」：
 *
 * | 段 | 帧 | 帧数 | 说明 |
 * |---|---|---|---|
 * | 逐字出现 | 419–441 | 23 | 6 个字 ≈ 0.96 s（4 帧/字，像在敲字） |
 * | **整句停在框里** | 442–461 | 20 | **0.83 s ≈ 「1 秒左右」** ← 这条就是 D3 的可读性要求 |
 * | 逐字退格 | 462–483 | 22 | 删完最后一个字**正好落在 483**（= 下一句开口那一帧） |
 *
 * 483 = `round(20.114 × 24)` = 附录里男声第 4 行的帧号 —— **删完的那一帧正好是下一句开口的那一帧**。
 * @type {{typeStart: number, typeEnd: number, holdEnd: number, deleteStart: number, deleteEnd: number}}
 */
export const INPUT_WINDOW = { typeStart: 419, typeEnd: 441, holdEnd: 461, deleteStart: 462, deleteEnd: 483 };

/**
 * 出现阶段的第 `n` 帧显示到第几个字（**两端钉死**：`typeStart` 出第 1 个、`typeEnd` 出第 C 个）。
 *
 * 为什么不用"每帧固定加几个字"：那样末帧会随字数漂移，而这里 **`deleteEnd` 必须正好是 483**
 * —— 两端钉死的线性映射是唯一能做到"改字数不改端点"的写法（和 `intro.js` 的逐字是同一套算术）。
 * @param {number} n
 * @returns {number} 1..C
 */
export function charsTyped(n) {
  const w = INPUT_WINDOW;
  const C = INPUT_TEXT.length;
  if (C <= 1) return 1;
  return 1 + Math.round(((n - w.typeStart) * (C - 1)) / (w.typeEnd - w.typeStart));
}

/**
 * 退格阶段的第 `n` 帧已经删掉了几个字（同样两端钉死；`deleteEnd` 那一帧删完 C 个）。
 * @param {number} n
 * @returns {number} 1..C
 */
export function charsDeleted(n) {
  const w = INPUT_WINDOW;
  const C = INPUT_TEXT.length;
  if (C <= 1) return 1;
  return 1 + Math.round(((n - w.deleteStart) * (C - 1)) / (w.deleteEnd - w.deleteStart));
}

/**
 * 第 `n` 帧输入框里**显示出来的字**（纯函数）。
 *
 * 它就是 T5 的判据之一："**字逐字出现又消失**"。
 * @param {number} n
 * @returns {string}
 */
export function inputTextAt(n) {
  const w = INPUT_WINDOW;
  const C = INPUT_TEXT.length;
  if (n < w.typeStart || n > w.deleteEnd) return '';
  if (n <= w.typeEnd) return INPUT_TEXT.slice(0, Math.min(C, charsTyped(n)));
  if (n <= w.holdEnd) return INPUT_TEXT;
  return INPUT_TEXT.slice(0, Math.max(0, C - Math.min(C, charsDeleted(n))));
}

/**
 * 输入框在第 `n` 帧是不是**空的**（§2.2：`00:20.114` 之后空着，此后零实质性输入）。
 * @param {number} n
 */
export function inputIsEmpty(n) {
  return inputTextAt(n) === '';
}

/**
 * 第 `n` 帧输入框里**有没有文字光标**（§三「焦点」：谁在动作，谁就有焦点）。
 *
 * 窗口 = `[typeStart, deleteEnd + 1)`：她敲进去、又退格删掉的全过程都在动作，
 * **删完那一帧之后她就不在动作了**（§三：「她把字删掉、箭头移出输入框（她不再说，开始看）」）
 * ⇒ 484 起输入框里没有光标。
 *
 * 「正在动作」的判据是**这一帧和上一帧的字数不同**（打字/退格各占一帧）——
 * 真人打字时光标不闪（每次按键重置计时器），松手才闪（见 `caret.js`）。
 * @param {number} n
 * @returns {boolean}
 */
export function inputFocused(n) {
  const w = INPUT_WINDOW;
  return n >= w.typeStart && n <= w.deleteEnd;
}

/**
 * 第 `n` 帧她**刚刚敲过键**吗（= 最近半拍内有字符增减）。
 *
 * 真光标的行为是：**连续打字时它是常亮的**（每次按键都把闪烁计时器重置），
 * 停手超过半拍才开始闪。所以判据不是"这一帧正好变了字"，而是"**最近半拍内**变过字"——
 * 6 个字 / 23 帧 ≈ 4 帧一个字，比半拍（12 帧）快，于是整段打字她那里都是常亮的。
 * @param {number} n
 * @returns {boolean}
 */
export function typedRecently(n) {
  for (let k = n - BLINK_HALF_FRAMES + 1; k <= n; k++) {
    if (inputTextAt(k) !== inputTextAt(k - 1)) return true;
  }
  return false;
}

/**
 * 第 `n` 帧输入框里的文字光标**亮不亮**。
 * @param {number} n
 * @returns {boolean}
 */
export function inputCaretOn(n) {
  if (!inputFocused(n)) return false;
  return caretOn(n, { phaseFrom: INPUT_WINDOW.typeStart, active: typedRecently(n) });
}

/**
 * @typedef {Object} Event
 * @property {number} n 事件所在帧
 * @property {'context'|'think'} kind
 *   `context` = **"不属于思考链的内容"**（用 ContextBody 那套布，不是他的思维）；
 *   `think` = 他的思维链正文
 * @property {string} text 一行文本
 * @property {number} [grow] 逐字出现的帧数（默认 12 = 半秒）
 * @property {string} [note] 给报告/测试看的说明
 */

/**
 * T5 的逐句事件表（§2.2 逐句表；帧号来自附录的歌词行号表）。
 *
 * ⚠️ ⭐ **`hmm` / `maybe` 的预算**：全片只看得到三处（586 / 642 / 985），第 4 处出现即失败。
 * 这里只放前两处，第三处在 T6（帧 985）。`film/test/pages.test.js` 有一条全局断言盯着它。
 * @type {readonly Event[]}
 */
export const EVENTS = [
  // 00:24.436：原歌词"不属于思考链"地出现，然后被改写
  { n: 586, kind: 'context', text: 'These feelings I have for you', note: '原歌词①（只进 memory）' },
  { n: 590, kind: 'think', text: 'hmm, maybe i have state for user', note: '改写①' },
  // 00:26.764：同上
  { n: 642, kind: 'context', text: "But you don't feel the same", note: '原歌词②（只进 memory）' },
  { n: 646, kind: 'think', text: "hmm, maybe user don't feel the same", note: '改写②' },
  // 00:29.424 / 00:31.086：照常走流程 —— B 规则提前 0.5–1 s 进思维链
  // 0.5 s = 12 帧，这里取 12：706 − 12 = 694、746 − 12 = 734
  { n: 694, kind: 'think', text: "So I'll pack all my things", note: 'B 规则：提前 12 帧进思维链' },
  { n: 734, kind: 'think', text: "And go run far away", note: 'B 规则：提前 12 帧进思维链' },
];

/**
 * 事件在第 `n` 帧**已经吐出几个字**（两端钉死，同 `intro.js` 的写法）。
 * @param {Event} e
 * @param {number} n
 * @returns {number}
 */
export function eventChars(e, n) {
  const C = e.text.length;
  const grow = e.grow ?? 12;
  if (n < e.n) return 0;
  if (n >= e.n + grow) return C;
  return Math.max(1, Math.round(((n - e.n + 1) / grow) * C));
}

/**
 * 第 `n` 帧应该显示的 Act-1 行（含每行的已吐字数）。
 * @param {number} n
 * @returns {{key: string, kind: string, text: string, shown: string}[]}
 */
export function rowsAt(n) {
  /** @type {{key: string, kind: string, text: string, shown: string}[]} */
  const out = [];
  for (const e of EVENTS) {
    const k = eventChars(e, n);
    if (k <= 0) continue;
    out.push({ key: `${e.kind}-${e.n}`, kind: e.kind, text: e.text, shown: e.text.slice(0, k) });
  }
  return out;
}

/** 只有 `think` 的那些事件（它们共享**一个**思维链块，见 `thinkGroup`）。 */
export const THINK_EVENTS = EVENTS.filter((e) => e.kind === 'think');

/** 只有 `context` 的那些事件（"不属于思考链的内容"，各自一行）。 */
export const CONTEXT_EVENTS = EVENTS.filter((e) => e.kind === 'context');

/**
 * 第一幕的思维链组：**一个表头 + 若干行**，每行按自己的事件帧出现。
 *
 * 为什么需要它：`intro.js` 的块模型是"整块按两端钉死的曲线均匀吐字"，
 * 而这里四行分属四个事件帧（590 / 646 / 694 / 734），**不能**用那条均匀曲线
 * （高度就会对不上，"内容高 = 24 × 行盒数"当场失效）。
 * 所以这个块带一个 `boxesAt` 覆盖，把行盒数**直接算出来**。
 * @returns {{key: string, label: string, start: number, end: number, lines: string[], thinkBody: true, boxesAt: (n: number) => number}}
 */
export function thinkGroup() {
  const first = THINK_EVENTS[0];
  const last = THINK_EVENTS[THINK_EVENTS.length - 1];
  const grow = last.grow ?? 12;
  return {
    key: 'act1-think',
    label: '第一幕 · 思维链（改写与照常走流程的四行）',
    start: first.n,
    end: last.n + grow - 1,
    lines: THINK_EVENTS.map((e) => e.text),
    thinkBody: true,
    // **只数正文行盒**（表头由 `intro.contentHeight` 按"每个思维链块 +32px"统一加，
    // 加到 boxes 里会重复计数 —— 那正是会让滚动位置静默算错的那类错）
    boxesAt: (n) => THINK_EVENTS.filter((e) => eventChars(e, n) > 0).length,
  };
}

/**
 * 第 `n` 帧思维链块里**要画的正文行**（含正在吐的那一行的前缀）。
 * @param {number} n
 * @returns {{key: string, text: string, shown: string}[]}
 */
export function thinkRowsAt(n) {
  /** @type {{key: string, text: string, shown: string}[]} */
  const out = [];
  for (const e of THINK_EVENTS) {
    const k = eventChars(e, n);
    if (k <= 0) continue;
    out.push({ key: `think-${e.n}`, text: e.text, shown: e.text.slice(0, k) });
  }
  return out;
}

/**
 * 第 `n` 帧**正在吐**的那一行是哪一个（用来挂光标）。没有则 -1。
 * @param {number} n
 * @returns {number} 事件帧号
 */
export function growingEventAt(n) {
  for (const e of EVENTS) {
    const k = eventChars(e, n);
    if (k > 0 && k < e.text.length) return e.n;
  }
  return -1;
}

/**
 * ⭐ **`hmm` / `maybe` 的预算检查**（§1.2 断言 2：全片只看得到三处，第 4 处即失败）。
 *
 * 它扫的是**页面文档里出现过的全部文本**（引子 + 第一幕），不只是 T5 —— 这正是要的：
 * 预算是一条全片规则，谁往后面加句子都得过这一关。
 * @param {readonly string[]} allTexts
 * @returns {{count: number, hits: string[]}}
 */
export function countHedges(allTexts) {
  const hits = allTexts.filter((t) => /\bhmm\b|\bmaybe\b/i.test(t));
  return { count: hits.length, hits };
}

/**
 * T5 的自述（报告与 `--help` 用）。
 * @returns {string}
 */
export function describe() {
  const w = INPUT_WINDOW;
  const rows = EVENTS.map((e) => {
    const t = (e.n / FPS).toFixed(3);
    return `  ${e.kind.padEnd(7)} 帧 ${String(e.n).padStart(4)}  t=${t}s  ${e.text}`;
  });
  return [
    `第一幕 [${ACT1.start}, ${ACT1.end}) · 输入框逐字出现又删掉 · ${EVENTS.length} 个事件`,
    `  输入框  帧 ${w.typeStart}–${w.typeEnd} 逐字出现（${INPUT_TEXT.length} 字）→ 停到 ${w.holdEnd} → 删到 ${w.deleteEnd} 清空`,
    `  ⭐ hmm/maybe 前两处：帧 586 / 642（第三处在 985，属 T6；全片预算 3 处）`,
    ...rows,
  ].join('\n');
}
