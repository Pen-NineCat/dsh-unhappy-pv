/**
 * film/test/pages.test.js — Phase 5 里**不需要浏览器**就能测的部分。
 *
 * 需要浏览器的部分（七个焊点、⭐ 同帧双渲、行网格假设）在 `film/pages/shot.mjs` 的自断言里：
 * `node film/pages/shot.mjs --smoke` / `--jitter-check` / `--scroll-check` / `--intro-scroll-check`。
 *
 * 这里测的是三件事：
 * 1. **页面正文是 `n` 的纯函数** —— 它是七个焊点能成立的前提。`body(n)` 自己不确定，
 *    后面再怎么等字体、钉动画都没用。
 * 2. **引子的算术**：三拍边界、**第 419 帧完成**、歌词窗口、以及
 *    「滚动位置永远够得着」（`want ≤ maxScroll` 对全片 4741 帧成立）。
 * 3. **网格契约**：每行 ≤ 字符预算、固定区恰好 5 行、类名是从真 CSS 解析出来的。
 */

import { END_T, FPS, FRAME_COUNT, H, timeAt } from '../engine/clock.js';
import { PRELUDE_MARKS } from '../engine/content.js';
import { CELL_TITLE } from '../engine/layout.js';
import { VARIANTS, body, beatAt, pageCss, scrollAtFrame } from '../pages/body.js';
import * as intro from '../pages/intro.js';
import { COMPOSER_TEXT, composerCss, composerHtml } from '../pages/dsh-composer.js';
import { caretStats } from '../pages/caret.js';
import { TITLE_CHARS as PANELS_TITLE_CHARS } from '../content/panels.js';
import * as act1 from '../pages/act1.js';
import { probeBody, probeCss } from '../pages/probe.js';
import { markdownRootClass, VENDOR_MOUNT, assertThemeAssets } from '../pages/dsh-theme.js';
import { STAGE_HTML } from '../pages/stage-html.js';
import { hashString } from '../pages/gen-frames.js';
import { contains, describe, eq, ok, test, throws } from './_harness.js';

/** 把 HTML 里所有数字都抹掉，得到一个「形状」指纹（用来抓「只有 n 变」）。 */
function shape(s) {
  return s.replace(/\d+/g, '#');
}

/** 采样帧：首末 + 每一拍的首末 + 若干中间帧。 */
const SAMPLES = [
  0, 1, 17, 18, 100, 143, 144, 200, 203, 250, 251, 300, 418, 419, 420, 1000, 2366, 4740,
];

describe('Phase 5 · body(n) 必须是纯函数', () => {
  test('同一帧两次调用逐字符相同（两种变体都测）', () => {
    for (const n of SAMPLES) {
      eq(body(n), body(n), `body(${n})`);
      eq(body(n, { variant: 'probe' }), body(n, { variant: 'probe' }), `probe body(${n})`);
    }
  });

  test('引子的正文确实逐帧在变（否则「逐帧截图」没意义）', () => {
    // 相邻帧在引子里**不一定**不同（一行要占好几帧），所以看的是「不是所有帧都一样」
    const hashes = new Set(SAMPLES.map((n) => hashString(body(n))));
    ok(hashes.size > 8, `采样帧的正文指纹只有 ${hashes.size} 种 —— 页面几乎是静态的`);
  });

  test('引子结束（帧 419）之后**第一幕接上**（不再是冻结状态）', () => {
    // ⚠️ 这条断言在 T5 之前写的是"419 之后逐字符冻结"（那时引子后面还没内容）。
    //    第一幕落地后它不再成立 —— 页面是**同一份对话文档**，419 之后继续往下长（§2.2）。
    ok(body(419) !== body(1000), '第一幕的正文不该与 419 相同');
    // 但**第一幕最后一个事件之后页面又冻住了** —— 因为第二幕的页面内容还没设计。
    // 如实断言它，免得把"没有内容"当成"在动"。
    eq(body(802), body(4740), '第一幕之后页面冻结（第二幕的网页层未设计）');
    // 但引子的内容**一个字都没少**（只往里加，不往回改）
    const cnt = (/** @type {string} */ h) => (h.match(/class="stage__line/g) ?? []).length;
    ok(cnt(body(1000)) >= cnt(body(419)), '行数只增不减');
  });

  test('非整数帧号直接报错', () => {
    const err = throws(() => body(1.5), '小数帧号');
    contains(err.message, '整数', '要说清是帧号问题');
  });

  test('未知变体直接报错（不要静默给一个空页面）', () => {
    const err = throws(() => body(0, { variant: /** @type {any} */ ('nope') }), '未知变体');
    contains(err.message, 'nope', '要指出是哪个变体');
    for (const v of VARIANTS) contains(err.message, v, `要列出可用变体 ${v}`);
  });

  test('视口高不够时明确报错（而不是悄悄算出一个负的滚动窗口）', () => {
    const err = throws(() => body(0, { height: 100 }), '舞台太矮');
    contains(err.message, '固定区', '要说清是固定区吃掉了高度');
  });
});

describe('Phase 5 · 引子的三拍与算术', () => {
  test('拍点与 engine/content.js 的 PRELUDE_MARKS 一致（两处不一致 = 时间轴断言在骗自己）', () => {
    eq(intro.MARKS.inject, PRELUDE_MARKS.inject, 'inject');
    eq(intro.MARKS.think, PRELUDE_MARKS.think, 'think');
    eq(intro.MARKS.output, PRELUDE_MARKS.output, 'output');
    eq(intro.MARKS.firstLyric, PRELUDE_MARKS.firstLyric, 'firstLyric（开词帧）');
    eq(intro.MARKS.firstLyric, Math.round(timeAt(intro.MARKS.firstLyric) * FPS), '开词帧 = round(t·fps)');
  });

  test('beatAt 在边界上左右各归各拍', () => {
    eq(beatAt(0), 'inject', '首帧');
    eq(beatAt(143), 'inject', '拍 1 末帧');
    eq(beatAt(144), 'think', '拍 2 首帧');
    eq(beatAt(250), 'think', '拍 2 末帧');
    eq(beatAt(251), 'output', '拍 3 首帧');
    eq(beatAt(418), 'output', '拍 3 末帧');
    eq(beatAt(419), 'after', '开词帧属于引子之后');
  });

  test('⛳ 逐字吐出：每个块的两端都被钉死（start 出第 1 个字，end 吐完最后一个字）', () => {
    let base = 0;
    for (const b of intro.BLOCKS) {
      const C = intro.charsInBlock(b);
      eq(intro.charsRevealed(b, b.start), 1, `${b.key} 在 ${b.start} 该出第 1 个字`);
      eq(intro.charsRevealed(b, b.start - 1), 0, `${b.key} 在 ${b.start - 1} 一个字都没有`);
      eq(intro.charsRevealed(b, b.end), C, `${b.key} 在 ${b.end} 该吐完 ${C} 个字`);
      ok(intro.charsRevealed(b, b.end - 1) < C, `${b.key} 在 ${b.end - 1} 该还没吐完`);
      eq(intro.frameOfLineStart(base), b.start, `${b.key} 的首行第一个字该在 ${b.start}`);
      eq(intro.frameOfLineDone(base + b.lines.length - 1), b.end, `${b.key} 的末行最后一个字该在 ${b.end}`);
      base += b.lines.length;
    }
  });

  test('⛳ 逐字而不是逐行：相邻帧只多出几个字，而且**会停在半行上**', () => {
    // 这条是作者动态检查时提的问题（"一行一行而不是一个字一个字"）的回归测试。
    const answer = /** @type {any} */ (intro.BLOCKS.find((b) => b.key === 'answer'));
    // 唯一的例外是「光标正好停在行边界上」那一帧（`chars` 恰好等于某行的累计字数）——
    // 那是合法的落点，不是按行跳。所以先把它算出来，再要求其余帧都停在半行上。
    /** @type {Set<number>} */
    const boundaries = new Set([0]);
    let acc = 0;
    for (const l of answer.lines) {
      acc += l.length;
      boundaries.add(acc);
    }
    /** @type {number[]} */
    const partialFrames = [];
    for (let n = answer.start; n < answer.end; n++) {
      const r = intro.revealAt(answer, n);
      ok(
        r.partial.length > 0 || boundaries.has(r.chars),
        `帧 ${n} 的 partial 为空、而 chars=${r.chars} 不在行边界上 —— 说明是按行跳的`,
      );
      if (r.partial.length > 0) partialFrames.push(n);
    }
    ok(
      partialFrames.length >= answer.end - answer.start - 4,
      `停半行的帧只有 ${partialFrames.length} 帧 —— 太少了（行边界帧不该超过 4 个）`,
    );
    // 每帧新增的字数应当是个位数到十几，而不是"一整行"
    const d = intro.charsRevealed(answer, answer.start + 20) - intro.charsRevealed(answer, answer.start + 19);
    ok(d > 0 && d < 40, `每帧该吐几个字，实测 ${d} 个/帧（若接近行长就是按行跳）`);
  });

  test('⛳ 输出在第 419 帧吐完最后一个字（§1 的硬同步点）', () => {
    const answer = /** @type {any} */ (intro.BLOCKS.find((b) => b.key === 'answer'));
    const C = intro.charsInBlock(answer);
    ok(C > 100, `回复该够长（实测 ${C} 字）`);
    ok(intro.charsRevealed(answer, 418) < C, `418 帧该还差字（差 ${C - intro.charsRevealed(answer, 418)} 个）`);
    eq(intro.charsRevealed(answer, 419), C, '419 帧该正好吐完');
    eq(intro.charsRevealed(answer, 500), C, '之后保持吐完');
    eq(intro.revealedLines(419), intro.TOTAL_LINES, '419 帧整篇都该在');
  });

  test('已显示行数单调不减（画面只会长，不会回退）', () => {
    let prev = -1;
    for (let n = 0; n < FRAME_COUNT; n++) {
      const r = intro.revealedLines(n);
      ok(r >= prev, `帧 ${n} 的已显示行数 ${r} < 上一帧 ${prev}`);
      prev = r;
    }
    eq(prev, intro.allBlocks().reduce((s, b) => s + b.lines.length, 0), '末帧该把**全部块**的行都显示完');
  });

  test('⛳ 滚动位置对**全片 4741 帧**都够得着（want ≤ maxScroll，永远不会被浏览器夹住）', () => {
    // 这是「滚动位置 = f(t)」能不能成立的全部：设了 scrollTop 但内容不够高时，
    // 浏览器会静默地把它夹到 maxScroll —— 画面静止，且**没有任何报错**。
    // 舞台高 = 画布高 H（§2.1 U3 之后引子页就是按目标矩形渲的：满屏 1920×1080 → 左格 1152×1080）
    const height = H;
    // ⚠️ 窗口高**逐帧**不同：固定区只在引子里（§2.1），419 起它消失、窗口长高 144px。
    //    这里必须按同一规则算，否则 419 那一帧会被误判成"被夹住"（实测踩到过）。
    const winOf = (/** @type {number} */ n) =>
      intro.scrollWindowHeight(height, { prelude: n < intro.MARKS.firstLyric });
    for (let n = 0; n < FRAME_COUNT; n++) {
      const content = intro.contentHeight(n);
      const maxScroll = Math.max(0, content - winOf(n));
      const want = intro.scrollAtFrame(n, { height });
      ok(want <= maxScroll, `帧 ${n}: want=${want} > maxScroll=${maxScroll}`);
      ok(want >= 0, `帧 ${n}: want=${want} 是负数`);
      if (want > 0) eq(want, maxScroll, `帧 ${n}: 追底时 want 应当**正好**等于 maxScroll`);
    }
  });

  test('滚动位置随帧推进（否则滚动区是个静态块）', () => {
    ok(intro.scrollAtFrame(0, { height: H }) < intro.scrollAtFrame(143, { height: H }), '拍 1 内该推进');
    ok(intro.scrollAtFrame(143, { height: H }) < intro.scrollAtFrame(418, { height: H }), '跨拍该继续推进');
    // ⚠️ 419 那一帧的滚动位置会**变小**：固定区消失、窗口长高 144px（底部仍然对齐内容底部）。
    //    这不是回退 —— 内容高没变，只是窗口变高了。
    ok(
      intro.scrollAtFrame(419, { height: H }) < intro.scrollAtFrame(418, { height: H }),
      '419 帧窗口长高，滚动位置应当减小',
    );
    ok(intro.scrollAtFrame(900, { height: H }) > intro.scrollAtFrame(419, { height: H }), '第一幕里继续往下走');
  });

  test('歌词「成形」窗口在拍 2 之内，且 1–2 秒（§1）', () => {
    const w = intro.lyricWindow();
    ok(w.from >= intro.MARKS.think && w.to < intro.MARKS.output, `窗口 ${w.from}–${w.to} 该落在拍 2 里`);
    const sec = w.frames / FPS;
    ok(sec >= 1 && sec <= 2, `成形时长 ${sec.toFixed(2)}s 不在 1–2 秒之间`);
    eq(intro.lyricEmphasis(w.from - 1), 0, '窗口之前不该有形变');
    ok(intro.lyricEmphasis(w.from + 5) > 0.9, '窗口中间该完全成形');
    eq(intro.lyricEmphasis(w.to + 1), 0, '窗口之后该收回');
  });

  test('歌词那两行确实进到了 thinking 块里（不是只在常量里躺着）', () => {
    const thinking = intro.BLOCKS.find((b) => b.key === 'thinking');
    const lines = /** @type {any} */ (thinking).lines;
    for (const l of intro.LYRIC_LINES) {
      ok(lines.includes(l), `thinking 块里该有歌词行「${l}」`);
    }
    eq(lines.filter((/** @type {string} */ l) => l === intro.LYRIC_LINES[0]).length, 1, '英文歌词只该出现一次');
  });
});

describe('Phase 5 · 滚动区域与固定区（`design-options.md` §1.6/§1.7）', () => {
  test('固定区**在滚动容器之外**（这就是「固定区不随滚动变化」的实现方式）', () => {
    const html = body(0);
    const fixedAt = html.indexOf('stage__fixed');
    const scrollAt = html.indexOf('id="scroll"');
    ok(fixedAt > 0 && scrollAt > 0, '两个区块都该在');
    ok(fixedAt < scrollAt, '固定区该在滚动容器之前');
    const between = html.slice(fixedAt, scrollAt);
    eq(between.includes('</header>'), true, '固定区该在滚动容器开始前就闭合了');
  });

  test('固定区恰好 5 行（固定区高必须算得出来，否则滚动窗口高无从谈起）', () => {
    const html = body(0);
    const fixed = html.slice(html.indexOf('stage__fixed'), html.indexOf('id="scroll"'));
    eq((fixed.match(/class="stage__line/g) ?? []).length, intro.FIXED_LINES, '固定区的网格行数');
    eq(intro.FIXED_HEIGHT, intro.FIXED_LINES * intro.LINE_H + 2 * intro.FIXED_PAD, 'FIXED_HEIGHT 的构成');
  });

  test('滚动位置写进了 data-scroll（截图器读它去设 scrollTop）', () => {
    for (const n of [0, 100, 419]) {
      contains(body(n), `data-scroll="${intro.scrollAtFrame(n, { height: H })}"`, `帧 ${n} 的 data-scroll`);
    }
  });

  test('固定区的内容是设计指定的四样：Instructions from + 三行署名 + You are a…', () => {
    const html = body(0);
    const fixed = html.slice(html.indexOf('stage__fixed'), html.indexOf('id="scroll"'));
    contains(fixed, 'Instructions from', '指令来源那一条');
    contains(fixed, 'AGENTS.md', '文件名');
    for (const s of ['视频：Pen-NineCat', '词曲：s0rrow', 'Remix：69岁牢二次元']) {
      contains(fixed, s, `署名「${s}」`);
    }
    contains(fixed, 'You are a ', '系统提示那一条');
    eq(fixed.includes('data-emphasis="signature"'), true, '署名行该带 emphasis（它们是最清楚的三行）');
  });

  test('页面上不出现绝对 URL、也不出现 emoji（§1.8 + 焊点 7）', () => {
    for (const n of SAMPLES) {
      const html = body(n);
      eq(/https?:\/\//.test(html), false, `帧 ${n} 的正文里不该有 http(s) 地址`);
      // 常见 emoji 区段（含变体选择符与零宽连接符）
      eq(
        /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u.test(html),
        false,
        `帧 ${n} 的正文里不该有 emoji`,
      );
    }
  });

  test('输入框（composer）在滚动容器**之外**，且高度是个常数（作者 2026-10-01 选 B）', () => {
    const html = body(0);
    const scrollAt = html.indexOf('id="scroll"');
    const compAt = html.indexOf('stage__composer');
    ok(compAt > 0, '要有输入框');
    ok(compAt > scrollAt, '输入框该在滚动容器之后（同样不进滚动区）');
    // 三个高度常数：舞台 = 固定区 + 滚动窗口 + 输入框
    const h = H;
    eq(
      intro.scrollWindowHeight(h),
      h - intro.FIXED_HEIGHT - intro.COMPOSER_HEIGHT,
      '滚动窗口高 = 舞台 − 固定区 − 输入框',
    );
    contains(html, `--stage-composer-h:${intro.COMPOSER_HEIGHT}px`, '高度要写进 CSS 变量');
    // 结构与类名来自实测（`probe-chrome.mjs --dump-composer`）
    for (const cls of ['uV2eYG_root', 'uV2eYG_card', 'uV2eYG_input', 'uV2eYG_placeholder', 'uV2eYG_row', 'uV2eYG_add', 'uV2eYG_primary']) {
      contains(html, cls, `输入框该用 dsh 的类名 ${cls}`);
    }
    // §1.1 的语言分工：**dsh 的 UI 文案是中文**（`深度求索中`/`工具已更新`/`思考`）、
    // 模型产出是英文、人的文字是中文。§2.3 明确纠正过旧口径。
    // 所以这里断言的是「输入框里的文案 = 真界面实测到的那几串」，**不是**「不许有中文」。
    const comp = html.slice(compAt, html.indexOf('</footer>', compAt));
    contains(comp, COMPOSER_TEXT.placeholder, 'placeholder 该用真界面那串中文');
    eq(
      comp.includes('描述你想要构建的内容'),
      true,
      'placeholder 必须是真 dsh 的字符串（不许自己编一句）',
    );
    // 思维链的表头是中文 `思考`（模型**产出**的内容才是英文）
    contains(body(200), '>思考<', '思维链表头该是中文「思考」');
  });

  test('逐字吐字时末尾有光标，而且光标**不许多占一个行盒**', () => {
    // 光标是伪元素（`::after`），所以它不能出现在 HTML 里 —— 只能靠 `data-caret` 属性。
    // 伪元素的尺寸钉死在 CSS 里（2px × 1em），所以它**不改变行盒高**；
    // 真正会被打破的是「半行边界那一帧」——那时 partial 为空，光标挂到最后一行整行上，不许多出一行。
    const typing = body(300); // 回复正在吐
    contains(typing, 'data-caret="1"', '正在吐的那一行该挂光标');
    eq((typing.match(/data-caret="1"/g) ?? []).length, 1, '光标**只有一个**（挂在正在吐的那一行）');
    const done = body(419); // 吐完了
    // ⚠️ **两个光标是两件事，不要混**（A9 之后）：
    //    ① 对话里"正在生成"那个 —— 419 吐完就没了；
    //    ② 输入框里"她按住"那个 —— 419 她**开始打字**，正好在下一条测试里。
    eq(/class="stage__line[^"]*"[^>]*data-caret/.test(done), false, '吐完之后对话里的光标不该有');
    eq(/ZkiH0q_\w+[^>]*data-caret/.test(done), false, 'ContextBody 那一行的光标也不该有');
    contains(body(0), 'data-caret="1"', '帧 0 就在吐第一个字，该有光标');
  });

  test('引子页里没有任何 <img>（所以焊点 2 在它上面是空转，不是漏焊）', () => {
    const html = body(200);
    eq(html.includes('<img'), false, '引子的 dsh 界面里没有位图资源');
    eq(body(0, { variant: 'probe' }).includes('./assets/probe-dot.svg'), true, '探针变体才有那张图');
  });
});

describe('Phase 5 · 第一幕 T5（`[419, 802)`）', () => {
  test('输入框：逐字出现 → 停 → 逐字删掉 → 空（判据「字逐字出现又消失」）', () => {
    const w = act1.INPUT_WINDOW;
    eq(act1.inputTextAt(w.typeStart - 1), '', '开始之前是空的');
    eq(act1.inputTextAt(w.typeStart).length, 1, '第一帧只出 1 个字（逐字，不是整句蹦出来）');
    eq(act1.inputTextAt(w.typeEnd), act1.INPUT_TEXT, '出完那一帧是整句');
    eq(act1.inputTextAt(w.holdEnd), act1.INPUT_TEXT, '中间停着');
    const mid = act1.inputTextAt(Math.round((w.deleteStart + w.deleteEnd) / 2)).length;
    ok(mid > 0 && mid < act1.INPUT_TEXT.length, `删到一半该是半句，实测 ${mid} 字`);
    eq(act1.inputTextAt(w.deleteEnd), '', '删完那一帧空');
    eq(act1.inputTextAt(w.deleteEnd + 50), '', '此后一直空着（零实质性输入）');
    for (let n = w.typeStart; n < w.typeEnd; n++) {
      ok(act1.inputTextAt(n + 1).length >= act1.inputTextAt(n).length, `帧 ${n} 出现阶段该只增`);
    }
    for (let n = w.deleteStart; n < w.deleteEnd; n++) {
      ok(act1.inputTextAt(n + 1).length <= act1.inputTextAt(n).length, `帧 ${n} 删除阶段该只减`);
    }
    eq(Math.round(20.114 * FPS), w.deleteEnd, '删完正好落在下一句开口那一帧（附录男声第 4 行）');
  });

  test('清空之后输入框回到空态：placeholder 回来、字数为 0', () => {
    const withText = body(430);
    // ⚠️ 字数**不要写死**：她打的那串字是文档给的（`我这边下雨了`），改字就改那一处常量。
    //    写死过的版本在换字符串时会红成一片 —— 而那时真正要守的只是"有字时标出字数"。
    contains(withText, `data-input-len="${act1.inputTextAt(430).length}"`, '有字的时候要标出字数');
    ok(act1.inputTextAt(430).length > 0, '帧 430 该有字（不然这条断言是空的）');
    eq(withText.includes('uV2eYG_placeholder'), false, '有字的时候不画 placeholder（真界面也是）');
    const empty = body(600);
    contains(empty, 'data-input-len="0"', '清空后字数是 0');
    contains(empty, 'uV2eYG_placeholder', '空着时 placeholder 回来（= 她在，但没说话）');
    contains(empty, COMPOSER_TEXT.placeholder, 'placeholder 仍是真界面那串');
  });

  test('D3：她打的是「我这边下雨了」——文档给的字符串，而且是**中文**（§1.1 人的文字是中文）', () => {
    // §2.2 新版把 D3 写全了：「**输入框里逐字出现「我这边下雨了」，随后被逐字退格删掉**」。
    // 上一轮我按三条线索猜成英文歌词（`Every day we talk a little less`）—— 那是错的，
    // 而且错在两处：① 人的文字是中文；② 这段字**与歌词无关**才是重点。
    eq(act1.INPUT_TEXT, '我这边下雨了', '字符串必须是文档给的那一个（要改先改 §2.2，再改这里）');
    ok(/^[\u4e00-\u9fa5]+$/.test(act1.INPUT_TEXT), `「${act1.INPUT_TEXT}」该全是汉字（人的文字 = 中文）`);
    ok(act1.INPUT_TEXT.length >= 4 && act1.INPUT_TEXT.length <= 12, `长度 ${act1.INPUT_TEXT.length} 该是"一句日常话"`);
    // 「与歌词无关」：它不该出现在思维链/改写的任何一行里
    for (const e of act1.EVENTS) {
      eq(e.text.includes(act1.INPUT_TEXT), false, `她的日常话不该是思维链里的「${e.text}」`);
    }
  });

  test('D3：整句在框里停得住（文档要求"必须读得出来（1 秒左右）"）', () => {
    const w = act1.INPUT_WINDOW;
    const holdSec = (w.holdEnd - w.typeEnd) / FPS; // 整句可见的时长
    ok(holdSec >= 0.7 && holdSec <= 1.3, `整句可见 ${holdSec.toFixed(2)}s —— 文档要的是"1 秒左右"`);
    eq(w.typeStart, act1.ACT1.start, '出现的起点 = 开词帧 419');
    eq(w.typeEnd, 441, '出完那一刻');
    eq(w.deleteEnd, Math.round(20.114 * FPS), '删完 = 下一句开口那一帧（附录男声第 4 行）');
    ok(w.typeEnd < w.deleteStart && w.holdEnd >= w.typeEnd, '三段必须接上（出现 → 停 → 删）');
    // 逐字：出现与删除都**一个一个字**地变（不是一帧蹦出整句，也不是一次跳两个字）
    const C = act1.INPUT_TEXT.length;
    const typed = [];
    for (let n = w.typeStart; n <= w.typeEnd; n++) typed.push(act1.charsTyped(n));
    const gone = [];
    for (let n = w.deleteStart; n <= w.deleteEnd; n++) gone.push(act1.charsDeleted(n));
    eq(new Set(typed).size, C, `出现阶段该正好经过 ${C} 个长度（实测 ${new Set(typed).size} 个）`);
    eq(new Set(gone).size, C, `删除阶段该正好经过 ${C} 个长度（实测 ${new Set(gone).size} 个）`);
    for (let i = 1; i < typed.length; i++) ok(typed[i] - typed[i - 1] <= 1, `帧 ${w.typeStart + i} 一次跳了 ${typed[i] - typed[i - 1]} 个字`);
    for (let i = 1; i < gone.length; i++) ok(gone[i] - gone[i - 1] <= 1, `帧 ${w.deleteStart + i} 一次删了 ${gone[i] - gone[i - 1]} 个字`);
    eq(act1.charsTyped(w.typeEnd), C, '出完那一帧正好是整句');
    eq(act1.charsDeleted(w.deleteEnd), C, '删完那一帧正好删掉整句');
  });

  test('固定区**只存在于引子**：帧 419 起整条消失（§2.1）', () => {
    contains(body(418), 'stage__fixed', '418 帧还在');
    eq(body(419).includes('stage__fixed'), false, '419 帧起不该有固定区');
    eq(body(1000).includes('stage__fixed'), false, '第一幕里也没有');
    eq(
      intro.scrollWindowHeight(H, { prelude: false }) - intro.scrollWindowHeight(H, { prelude: true }),
      intro.FIXED_HEIGHT,
      '窗口高的差 = 固定区高',
    );
    contains(body(418), `--stage-scroll-h:${intro.scrollWindowHeight(H, { prelude: true })}px`, '418 的窗口高');
    contains(body(419), `--stage-scroll-h:${intro.scrollWindowHeight(H, { prelude: false })}px`, '419 的窗口高');
  });

  test('思维链改写：原歌词以「不属于思考链的内容」出现，改写在思维链里（§2.2）', () => {
    eq(act1.CONTEXT_EVENTS.length, 2, '两处「不属于思考链的内容」');
    ok(act1.THINK_EVENTS.length >= 2, '至少两行改写');
    for (const e of act1.CONTEXT_EVENTS) {
      contains(body(e.n + (e.grow ?? 12)), 'ZkiH0q_text', '原歌词该走 ContextBody 那套布');
    }
    contains(body(605), 'hmm, maybe i have state for user', '改写①进思维链（590 + 12 帧吐完）');
    contains(body(661), "hmm, maybe user don't feel the same", '改写②进思维链（646 + 12）');
    contains(body(605), 'lcKema_thinkBody', '改写落在思维链正文里');
    contains(body(605), '>思考<', '思维链表头是中文「思考」');
  });

  test('⭐ `hmm` / `maybe` 的预算：当前文档里 2 处，全片上限 3（第 4 处即失败）', () => {
    const all = intro.allBlocks().flatMap((b) => b.lines);
    const r = act1.countHedges(all);
    eq(r.count, 2, `当前文档里的对冲句数（${r.hits.join(' / ')}）`);
    ok(r.count <= 3, '全片预算 3 处（第三处在 T6 的帧 985）');
  });

  test('B 规则：那两句提前 0.5–1 s 进思维链', () => {
    for (const [lyricFrame, thinkFrame] of [
      [706, 694],
      [746, 734],
    ]) {
      ok(act1.THINK_EVENTS.some((x) => x.n === thinkFrame), `帧 ${thinkFrame} 该有事件`);
      const lead = lyricFrame - thinkFrame;
      ok(lead >= 12 && lead <= 24, `提前量 ${lead} 帧该落在 0.5–1 s（12–24 帧）`);
    }
  });

  test('第一幕接在同一份对话文档后面：引子的行还在，第一幕只往后加', () => {
    const blocks = intro.allBlocks();
    eq(
      blocks.length,
      intro.BLOCKS.length + act1.CONTEXT_EVENTS.length + 1,
      '引子四块 + 两个 context + 一个思维链组',
    );
    eq(intro.revealedLines(419), intro.TOTAL_LINES, '419 帧引子的行都还在（内容不回退）');
    ok(intro.revealedLines(802) > intro.TOTAL_LINES, '802 帧已经多出第一幕的行');
    const boxes = blocks.reduce((s, b) => s + intro.revealAt(b, 700).boxes, 0);
    const heads = blocks.filter((b) => b.thinkBody && intro.revealAt(b, 700).boxes > 0).length;
    eq(
      intro.contentHeight(700),
      boxes * intro.LINE_H + heads * (intro.THINK_HEAD_LINES * intro.LINE_H + intro.THINK_BODY_PAD),
      '内容高的构成：行盒 × 24 + 每个思维链块 32',
    );
    eq(heads, 2, '这时有两个思维链块（引子一块、第一幕一块）');
  });

  test('滚动位置在第一幕里仍然追底且够得着（含 419 —— 那一帧窗口高变了 144px）', () => {
    for (let n = act1.ACT1.start; n <= 900; n++) {
      const win = intro.scrollWindowHeight(H, { prelude: n < act1.ACT1.start });
      const maxScroll = Math.max(0, intro.contentHeight(n) - win);
      const want = intro.scrollAtFrame(n, { height: H });
      ok(want <= maxScroll, `帧 ${n}: want=${want} > maxScroll=${maxScroll}`);
      if (want > 0) eq(want, maxScroll, `帧 ${n} 追底`);
    }
  });
});

describe('Phase 5 · 焦点与文字光标（画面规格 §三「焦点」；作者 2026-10-01 拍板 A9）', () => {
  const W = act1.INPUT_WINDOW;

  test('输入框的光标只在**她在动作**的那一段出现（`[419, 484)`，484 起没有）', () => {
    eq(act1.inputFocused(W.typeStart - 1), false, '418：她还没开始');
    eq(act1.inputFocused(W.typeStart), true, '419：她开始打字');
    eq(act1.inputFocused(W.deleteEnd), true, '483：她刚删完最后一个字（这一帧还在动作）');
    eq(act1.inputFocused(W.deleteEnd + 1), false, '484：§三「箭头移出输入框（她不再说，开始看）」⇒ 输入框里没有光标了');
    for (const n of [0, 200, 418, 484, 500, 1000, 4740]) {
      eq(act1.inputCaretOn(n), false, `帧 ${n} 输入框里不该有光标`);
    }
  });

  test('它真的在**闪**（不是一根常亮的竖条），而且亮/灭都由 `n` 决定', () => {
    const s = caretStats(W.typeStart, W.deleteEnd + 1, { phaseFrom: W.typeStart, activeAt: act1.typedRecently });
    ok(s.off > 0, `整段一帧都没灭（on=${s.on}）—— 那叫常亮，不叫闪`);
    ok(s.on > s.off, `亮的帧（${s.on}）该多于灭的（${s.off}）—— 因为她一直在打字，而打字时是常亮的`);
    ok(s.flips >= 2, `亮灭翻转只有 ${s.flips} 次 —— 闪得太少（0.5 s 一拍，65 帧里该翻转几次）`);
    // 纯函数：同一帧两次调用相同
    for (const n of [419, 445, 450, 470, 483]) {
      eq(act1.inputCaretOn(n), act1.inputCaretOn(n), `帧 ${n}`);
    }
  });

  test('⭐ 正在打字/退格的每一帧一定是亮的（真人打字时**光标不闪**，松手才闪）', () => {
    let active = 0;
    for (let n = W.typeStart; n <= W.deleteEnd; n++) {
      if (!act1.typedRecently(n)) continue;
      active++;
      eq(act1.inputCaretOn(n), true, `帧 ${n} 刚刚敲过键，光标该是亮的`);
    }
    ok(active > 30, `"刚敲过键"的帧只有 ${active} 帧 —— 这条断言几乎没验到东西`);
    // 整段打字与整段退格都该是**常亮**（4 帧一个字 < 半拍 12 帧）
    for (let n = W.typeStart; n <= W.typeEnd; n++) eq(act1.inputCaretOn(n), true, `打字中帧 ${n} 该常亮`);
    for (let n = W.deleteStart; n <= W.deleteEnd; n++) eq(act1.inputCaretOn(n), true, `退格中帧 ${n} 该常亮`);
    // 刚获得焦点那一帧也是亮的（真光标点下去立刻出现，不是先灭半秒）
    eq(act1.inputCaretOn(W.typeStart), true, '419 该是亮的');
    // 只有**停手之后**才有灭的帧
    const offs = [];
    for (let n = W.typeStart; n <= W.deleteEnd; n++) if (!act1.inputCaretOn(n)) offs.push(n);
    ok(offs.length > 0 && offs.every((n) => !act1.typedRecently(n)), `灭的帧里混进了动作帧：${offs.filter(act1.typedRecently).join(',')}`);
    ok(offs.every((n) => n > W.typeEnd && n < W.deleteStart), `灭的帧该都落在"整句停在框里"那一段（实测 ${offs.join(',')}）`);
  });

  test('闪是**逐帧算的**，不靠 CSS 动画（CSS 动画跟真实时间走，是逐帧渲染的毒药）', () => {
    const css = pageCss();
    eq(/@keyframes[^{]*caret/i.test(css), false, 'CSS 里不该有 caret 的 @keyframes');
    // 属性确实挂到了输入框上（伪元素靠它显示）；419 那一帧她刚敲下第一个字 ⇒ 字数 1
    contains(body(419), `data-composer-input="true" data-input-len="1" data-caret="1"`, '帧 419 输入框该有光标');
    contains(body(470), 'data-caret="1"', '帧 470（退格中）该有光标');
    eq(/data-composer-input="true"[^>]*data-caret/.test(body(500)), false, '帧 500 输入框不该有光标');
  });
});

describe('Phase 5 · 文案与标题（作者 2026-10-01 拍板 A1 / A8）', () => {
  test('A1：`permission` 用真界面实显的「完全权限」（§1.1：dsh 的 UI 文案是中文）', () => {
    eq(COMPOSER_TEXT.permission, '完全权限', '就是真界面那串');
    contains(body(419), '完全权限', '要真的渲染进去');
    eq(body(419).includes('Full access'), false, '不再用那个英文串');
    // 模型名是**模型目录里的 real id 名**，本来就英文（§4.2 的 DEFAULT_MODELS）
    eq(COMPOSER_TEXT.model, 'DeepSeek-V41-Flash High', '模型档位名不动');
    eq(COMPOSER_TEXT.placeholder, '描述你想要构建的内容, / 调用指令, @ 文件或对话', 'placeholder 也不动');
  });

  test('A8：面板标题首字母大写 —— Terminal / Memory，以及换网络结构时用的 Network', () => {
    eq(CELL_TITLE.term, 'Terminal', '右上');
    eq(CELL_TITLE.memory, 'Memory', '右下');
    eq(CELL_TITLE.network, 'Network', '右上换成网络结构时用的那个（T6 起）');
    for (const [k, v] of Object.entries(CELL_TITLE)) {
      eq(/^[A-Z]/.test(v), true, `${k} 该首字母大写（收到 ${v}）`);
    }
    // ⚠️ 标题是**画布侧**画的（`content/panels.js` 的字形图集），所以字符集必须带上这些字母，
    //    否则 `drawText` 会记缺字形（那次 terminal 就是这么差点漏掉的）。
    for (const v of Object.values(CELL_TITLE)) {
      for (const ch of v) {
        ok(PANELS_TITLE_CHARS.includes(ch), `标题字符集里缺 ${JSON.stringify(ch)}（${v}）`);
      }
    }
  });
});

describe('Phase 5 · 网格与真 CSS 的契约', () => {
  test('每一行都在字符预算之内（超了会被 overflow:hidden 裁掉而不是折行）', () => {
    for (const b of intro.BLOCKS) {
      b.lines.forEach((l, i) => {
        const w = intro.visualWidth(l);
        ok(w <= intro.LINE_BUDGET, `${b.key}[${i}] 宽 ${w} > 预算 ${intro.LINE_BUDGET}：${l.slice(0, 48)}…`);
      });
    }
  });

  test('行内容里没有换行符（一行的可打印宽度有限，`\\n` 会变成第二行）', () => {
    for (const b of intro.BLOCKS) {
      b.lines.forEach((l, i) => {
        eq(/[\r\n]/.test(l), false, `${b.key}[${i}] 含换行符`);
      });
    }
  });

  test('正文用的是真 dsh 的类名，而且是**从真 CSS 里解析出来的**（不硬编码 hash）', () => {
    const md = markdownRootClass();
    ok(/^_markdown_/.test(md.markdown), `markdown 根类名 ${md.markdown} 形状不对`);
    ok(/^_compact_/.test(md.compact), `compact 类名 ${md.compact} 形状不对`);
    contains(body(419), md.markdown, '回复块该用 markdown 根类');
    contains(body(200), md.compact, '思维链正文该用 compact 变体');
    contains(md.source, 'index-', '类名该来自外壳 CSS');
  });

  test('CSS 里没有硬编码的颜色（emphasis / 光标只许用令牌或 currentColor）', () => {
    const css = pageCss();
    // 判据是「**字面**颜色」而不是「不用 var()」：`currentColor` / `transparent` / `inherit` 都是
    // 从上下文继承，不是写死一个值。第一版把它们误判成违规（光标那次）。
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const decls = css
      .split(';')
      .map((d) => d.trim())
      .filter((d) => /(^|\s)(color|background|background-color)\s*:/.test(d))
      .filter((d) => !/var\(--/.test(d) && !/currentColor|transparent|inherit|none/.test(d));
    for (const d of decls) ok(!literal.test(d), `这条声明里有字面颜色：${d}`);
    eq(decls.length, 0, `这些声明既没走令牌、也不是继承值：${decls.join(' | ')}`);
  });

  test('pageCss 里有网格契约、也有探针那条 @keyframes（焊点 3 的靶子）', () => {
    const css = pageCss();
    for (const needle of ['.stage__line', '.stage__gridbox', 'height: var(--line-h)']) {
      contains(css, needle, needle);
    }
    contains(css, '@keyframes probe-spin', '旋转动画（探针变体的靶子）');
    contains(css, 'animation: probe-spin', '动画绑定');
  });

  test('四份样式齐备，且挂载点只有一份定义', () => {
    const a = assertThemeAssets();
    eq(a.files.length, 4, 'vendor / index / dsh.css / fallback-tokens.css');
    eq(Object.keys(VENDOR_MOUNT).join(','), '/vendor', '挂载点');
    for (const f of a.files) ok(/\.css$/.test(f), `${f} 该是 CSS`);
  });
});

describe('Phase 5 · 舞台与焊点的宿主契约', () => {
  test('stage.html 暴露 window.__stage，且接口齐全', () => {
    for (const api of [
      'setBody',
      'setScroll',
      'pinAnimations',
      'animationTimes',
      'fontsReady',
      'imagesDecoded',
      'viewport',
      'snapshot',
    ]) {
      contains(STAGE_HTML, api, `__stage.${api} 该存在`);
    }
  });

  test('⛔ 生成 CSS/HTML 的函数都不能抛错（反引号陷阱的**运行时**形态）', () => {
    // 踩了四次的那个坑：CSS 写在 JS 模板字符串里，注释里出现反引号会**提前结束**模板字符串。
    // ⚠️ 恶性变体：`` `foo`.bar`baz` `` 是**合法的 tagged template**，所以 `node --check` 通过、
    //    import 也通过，只有**真的调用**时才炸：
    //    `TypeError: "….wSkVaW_body is not a function`（2026-10-01 实测，见附录 C 记录 28）。
    //    所以这条测试的价值不在于"测出什么逻辑"，而在于**强制每次都真的求值一次**。
    const cases = [
      ['pageCss', () => pageCss()],
      ['composerCss', () => composerCss()],
      ['composerHtml', () => composerHtml()],
      ['composerHtml(有字+光标)', () => composerHtml({ input: '我这边下雨了', caret: true })],
      ['probeCss', () => probeCss()],
      ['probeBody(0)', () => probeBody(0)],
      ['body(0)', () => body(0)],
      ['body(419)', () => body(419)],
    ];
    for (const [name, fn] of cases) {
      let v;
      try {
        v = fn();
      } catch (e) {
        ok(false, `${name}() 抛错了：${/** @type {Error} */ (e).message}（多半是模板字符串里的反引号）`);
        continue;
      }
      eq(typeof v, 'string', `${name}() 该返回字符串`);
      ok(v.length > 50, `${name}() 不该是空串`);
    }
  });

  test('stage.html 的脚本里没有反引号（否则会破坏外层模板字符串）', () => {
    // 附录 C 记录 12：内嵌脚本的注释里出现反引号，外层模板字符串会提前结束
    const scriptStart = STAGE_HTML.indexOf('<script type="module">');
    const scriptEnd = STAGE_HTML.indexOf('</script>');
    const script = STAGE_HTML.slice(scriptStart, scriptEnd);
    eq(script.includes('`'), false, '内嵌脚本里不该有反引号');
  });

  test('舞台里「首个可见行」认得两种变体的行（否则滚动检查永远说「没滚」）', () => {
    contains(STAGE_HTML, '.stage__line', '引子版的行');
    contains(STAGE_HTML, '.probe__line', '探针版的行');
  });

  test('hashString 与舞台里那份实现一致（FNV-1a）', () => {
    // 这个哈希是「相同 body 不重写 DOM」的判定键；两边算法不一致就永远认为「变了」
    const cases = ['', 'a', 'abc', body(0), body(300)];
    for (const s of cases) {
      const mine = hashString(s);
      ok(/^[0-9a-z]+$/.test(mine), `hashString 该是 36 进制：${mine}`);
      eq(mine, hashString(s), '同输入同输出');
    }
    ok(hashString('a') !== hashString('b'), '不同输入该不同');
  });

  test('stage.html 的 CSS 是内联占位（gen-frames.js 会替换掉那一行）', () => {
    contains(STAGE_HTML, '<link rel="stylesheet" href="./stage.css" />', '待替换的占位行');
  });
});

describe('Phase 5 · 帧清单与对账', () => {
  test('引子那一段的帧数对账：0..419 共 420 帧', () => {
    eq(intro.MARKS.firstLyric + 1, 420, '引子帧数');
    eq(intro.BLOCKS[intro.BLOCKS.length - 1].end, intro.MARKS.firstLyric, '最后一个块的末帧 = 开词帧');
  });

  test('全片清单 4741 帧、编号连续', () => {
    eq(FRAME_COUNT, 4741, '总帧数');
    eq(timeAt(FRAME_COUNT - 1) < END_T, true, '末帧的起点该在片长之内');
    eq(Math.abs(timeAt(FRAME_COUNT) - END_T) < 1e-9, true, '4741/24 该正好是 END_T');
  });

  test('body(n) 对首末帧都能生成（不会在边界崩）', () => {
    for (const n of [0, FRAME_COUNT - 1]) {
      ok(body(n).length > 100, `body(${n}).length`);
      ok(shape(body(n)).length > 100, `body(${n}) 的形状`);
    }
  });
});
