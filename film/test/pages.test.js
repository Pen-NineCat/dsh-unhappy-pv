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

import { END_T, FPS, FRAME_COUNT, timeAt } from '../engine/clock.js';
import { PRELUDE_MARKS } from '../engine/content.js';
import { VARIANTS, body, beatAt, pageCss, scrollAtFrame } from '../pages/body.js';
import * as intro from '../pages/intro.js';
import { COMPOSER_TEXT } from '../pages/dsh-composer.js';
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

  test('引子结束（帧 419）之后正文**冻结**：419..4740 逐字符相同', () => {
    // 这是设计上要的（引子只到 419，之后的画面另有其人负责），
    // 顺带也是焊点 4 第一次拿到真正的用武之地：4000 多帧共用同一个 DOM。
    const frozen = body(419);
    for (const n of [420, 500, 1000, 2366, 4740]) eq(body(n), frozen, `body(${n}) 该与 419 相同`);
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
    eq(prev, intro.TOTAL_LINES, '末帧该全部显示完');
  });

  test('⛳ 滚动位置对**全片 4741 帧**都够得着（want ≤ maxScroll，永远不会被浏览器夹住）', () => {
    // 这是「滚动位置 = f(t)」能不能成立的全部：设了 scrollTop 但内容不够高时，
    // 浏览器会静默地把它夹到 maxScroll —— 画面静止，且**没有任何报错**。
    const height = 640;
    const win = intro.scrollWindowHeight(height);
    for (let n = 0; n < FRAME_COUNT; n++) {
      const content = intro.contentHeight(n);
      const maxScroll = Math.max(0, content - win);
      const want = intro.scrollAtFrame(n, { height });
      ok(want <= maxScroll, `帧 ${n}: want=${want} > maxScroll=${maxScroll}`);
      ok(want >= 0, `帧 ${n}: want=${want} 是负数`);
      if (want > 0) eq(want, maxScroll, `帧 ${n}: 追底时 want 应当**正好**等于 maxScroll`);
    }
  });

  test('滚动位置随帧推进（否则滚动区是个静态块）', () => {
    ok(intro.scrollAtFrame(0, { height: 640 }) < intro.scrollAtFrame(143, { height: 640 }), '拍 1 内该推进');
    ok(intro.scrollAtFrame(143, { height: 640 }) < intro.scrollAtFrame(418, { height: 640 }), '跨拍该继续推进');
    eq(scrollAtFrame(419), scrollAtFrame(4740), '引子之后该冻住');
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
      contains(body(n), `data-scroll="${intro.scrollAtFrame(n, { height: 640 })}"`, `帧 ${n} 的 data-scroll`);
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
    const h = 640;
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
    eq(done.includes('data-caret'), false, '吐完之后不该有光标');
    contains(body(0), 'data-caret="1"', '帧 0 就在吐第一个字，该有光标');
  });

  test('引子页里没有任何 <img>（所以焊点 2 在它上面是空转，不是漏焊）', () => {
    const html = body(200);
    eq(html.includes('<img'), false, '引子的 dsh 界面里没有位图资源');
    eq(body(0, { variant: 'probe' }).includes('./assets/probe-dot.svg'), true, '探针变体才有那张图');
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
