/**
 * film/pages/stage-html.js — 截图舞台（Phase 5 的**第 7 个焊点：资源全部本地**的宿主）。
 *
 * 它做四件事，全部为了「同一 `n` 截两次逐像素一致」：
 *
 * 1. **挂载点** `#app`：每帧的正文由 `shot.mjs` 通过 `page.evaluate` 注入（走 `body.js`）。
 * 2. **焊点 7（本地资源）**：只用相对路径。`./assets/…` 由 `shot.mjs` 的静态服务器提供，
 *    指向 `out/gen/assets/`。
 * 3. **暴露 `window.__stage`**：给 `shot.mjs` 一个**显式接口**去等待与钉时间
 *    （不猴补丁、不去猜 DOM 结构，`AGENTS.md` §7 架构纪律）。
 * 4. **不让浏览器自己动**：没有 `setTimeout` 驱动的动画、没有网络请求、没有随机。
 *
 * ⚠️ 写法约束（踩过的坑，附录 C 记录 12）：这里的 HTML 里**嵌了一段 JS**，
 * 而外层又是 JS 的模板字符串 —— 只要内嵌脚本的注释里出现反引号，
 * 外层模板字符串就提前结束，报出完全看不懂的语法错。
 * 所以内嵌脚本的注释**一律不用反引号**，并且整段用 `String.raw`。
 */

const SCRIPT = String.raw`
const app = document.getElementById('app');

// 焊点 3：用 Web Animations 把 CSS 动画 pause() 并按帧号设 currentTime。
// 必须在 innerHTML 之后设（施工说明 §6 Phase 5 第 3 条）：
// 元素是新的，动画实例也是新的，先设了就会被后面的 innerHTML 冲掉。
function pinAnimations(n) {
  const animations = app.getAnimations({ subtree: true });
  const tMs = (n / 24) * 1000;
  for (const a of animations) {
    a.pause();
    a.currentTime = tMs;
  }
  return animations.length;
}

window.__stage = {
  // 设置正文。第 4 个焊点：相同 body 不重写 DOM。
  setBody(html) {
    const key = String(html).length + ':' + hashString(html);
    if (app.dataset.body === key) return { rewritten: false, key };
    app.dataset.body = key;
    app.innerHTML = html;
    return { rewritten: true, key };
  },

  // 焊点 7 的辅助：把滚动位置设成 f(t)（不用 CSS 动画、不用 sticky）。
  setScroll(px) {
    const sc = document.getElementById('scroll');
    if (sc) sc.scrollTop = px;
    return sc ? sc.scrollTop : -1;
  },

  pinAnimations,

  // 读回动画的 currentTime，测试用它验证焊点 3 真的钉住了。
  animationTimes() {
    return app.getAnimations({ subtree: true }).map((a) => {
      // ⚠️ R1 的引子页上唯一的动画在**伪元素 ::after** 上（思维链的扫描），
      // 所以这里连 pseudoElement 与 animationName 一起报出来 —— 否则「有动画」这件事
      // 在报告里就只剩一个数字，说不出是哪条。
      const eff = a.effect;
      return {
        state: a.playState,
        t: a.currentTime,
        name: a.animationName || null,
        pseudo: eff && 'pseudoElement' in eff ? eff.pseudoElement || null : null,
      };
    });
  },

  // 焊点 1：等 document.fonts.ready。
  async fontsReady() {
    await document.fonts.ready;
    return { status: document.fonts.status, count: [...document.fonts].length };
  },

  // 焊点 2：等所有 img 的 decode()。失败不算致命（记下来）。
  async imagesDecoded() {
    const imgs = [...app.querySelectorAll('img')];
    const results = await Promise.all(
      imgs.map((i) => i.decode().then(() => 'ok', (e) => 'fail:' + (e && e.message))),
    );
    return { count: imgs.length, results, complete: imgs.map((i) => i.complete) };
  },

  // 焊点 6：固定 viewport 与 deviceScaleFactor —— 由 shot.mjs 在 newPage 时定，这里读回来记录。
  viewport() {
    return { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
  },

  // 诊断：把结构、滚动、动画、旋转角打出来。
  snapshot() {
    const all = [...app.querySelectorAll('*')];
    const sc = document.getElementById('scroll');
    const spin = document.getElementById('spin');
    return {
      elementCount: all.length,
      html: app.innerHTML.length,
      classes: [...new Set(all.flatMap((e) => [...e.classList]))].slice(0, 40),
      text: (app.textContent || '').slice(0, 200),
      scroll: sc ? sc.scrollTop : -1,
      scrollHeight: sc ? sc.scrollHeight : -1,
      clientHeight: sc ? sc.clientHeight : -1,
      maxScroll: sc ? sc.scrollHeight - sc.clientHeight : -1,
      firstVisibleLine: sc ? (function () {
        const rect = sc.getBoundingClientRect();
        // 两种变体各自的「一行」（intro 是 24px 网格的 .stage__line，probe 是 .probe__line）
        const lines = [...sc.querySelectorAll('.stage__line,.probe__line')];
        for (const el of lines) {
          if (el.getBoundingClientRect().bottom > rect.top + 1) {
            return (el.textContent || '').trim().slice(0, 24);
          }
        }
        return null;
      })() : null,
      animations: app.getAnimations({ subtree: true }).length,
      animNames: app.getAnimations({ subtree: true }).slice(0, 6).map((a) => ({
        name: a.animationName || null,
        pseudo: a.effect && 'pseudoElement' in a.effect ? a.effect.pseudoElement || null : null,
      })),
      spinTransform: spin ? getComputedStyle(spin).transform : null,
      fonts: [...document.fonts].map((f) => f.family + ' ' + f.status).slice(0, 8),
    };
  },
};

// 一个稳定的字符串哈希（只为「body 有没有变」用，不参与画面）。
// 必须与 gen-frames.js 里那份实现一致（同一个 FNV-1a），否则焊点 4 会永远说「变了」。
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
`;

export const STAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>dsh-unhappy-pv · screenshot stage</title>
<!-- 这一行会被 gen-frames.js 替换成内联的 style（少一个请求就少一个 404 可能） -->
<link rel="stylesheet" href="./stage.css" />
</head>
<body>
<div id="app" data-body=""></div>
<script type="module">${SCRIPT}</script>
</body>
</html>
`;

export default STAGE_HTML;
