/**
 * film/test/probe-r1-dom.mjs — 用 R2 拿到的**真 DOM** 当参考，量 R1 要复现的东西有多大。
 *
 * 目的不是搭 R1，而是把「R1 要自己猜多少」变成数字：
 *   - 输入框（composer）那一块：多少层 DOM、用到几个类名、里面几个 data-* 属性
 *   - 一条会话消息渲染出来是什么结构
 *   - 引子里真正需要的那几样（context 块 / 署名行）对应哪几个类名
 *
 * 用法：node film/test/probe-r1-dom.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DSH_BIN = 'E:\\NodeJSGlobalPackage\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js';
const OUT = 'out/r1dom';

/** 起 dsh web 并解析出带 token 的 URL（与 probe-r2.mjs 同法）。 */
function bootDshWeb(port) {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [DSH_BIN, '--profile', 'web', '--port', String(port), '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    /** @type {string[]} */
    const lines = [];
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        proc.kill();
        rej(new Error(`启动超时：\n${lines.join('\n')}`));
      }
    }, 30000);
    const onData = (/** @type {Buffer} */ chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) if (line.trim()) lines.push(line.trim());
      const m = /(http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+))/.exec(lines.join('\n'));
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        res({ url: m[1], port: Number(m[2]), proc });
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => !done && ((done = true), clearTimeout(timer), rej(e)));
    proc.on('exit', (c) => !done && ((done = true), clearTimeout(timer), rej(new Error(`提前退出 ${c}`))));
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const boot = await bootDshWeb(0);
  console.log(`dsh web 起在 ${boot.port}`);
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(boot.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4500);

    const dump = await page.evaluate(() => {
      /** 把一个元素序列化成「结构摘要」：标签.class[data-*] */
      function sig(el) {
        const cls = [...el.classList];
        const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name + '=' + a.value);
        const role = el.getAttribute('role');
        const tag = el.tagName.toLowerCase();
        return tag + (cls.length ? '.' + cls.join('.') : '') + (data.length ? '[' + data.join('][') + ']' : '') + (role ? '{role=' + role + '}' : '');
      }
      function tree(el, depth) {
        let out = '  '.repeat(depth) + sig(el) + '\n';
        for (const c of el.children) out += tree(c, depth + 1);
        return out;
      }
      /** 找一个元素：优先按文本，其次按类名片段 */
      function findByText(t) {
        const all = [...document.querySelectorAll('*')];
        return all.find((e) => e.children.length === 0 && (e.textContent ?? '').trim() === t) ?? null;
      }
      /** 往上找到「有 hash 类名的那一层」 */
      function climb(el, n) {
        let cur = el;
        for (let i = 0; i < n && cur?.parentElement; i++) cur = cur.parentElement;
        return cur;
      }

      // 输入框那一块：编辑器
      const editable = document.querySelector('[contenteditable="true"], textarea');
      const composerRoot = editable ? climb(editable, 3) : null;

      // 一条会话行（侧栏）
      const sessionRow = document.querySelector('[class*="_entry"]') ?? null;

      // 「新会话」按钮
      const newSession = findByText('新会话');
      const newSessionRow = newSession ? climb(newSession, 2) : null;

      // 主区域
      const main = document.querySelector('main, [class*="regionArea"], [class*="conversation"]');

      /** 统计一棵子树里用到的类名与 data-* 属性 */
      function stats(root) {
        if (!root) return null;
        const els = [root, ...root.querySelectorAll('*')];
        const classes = new Set();
        const dataAttrs = new Set();
        let maxDepth = 0;
        let hashClasses = 0;
        for (const e of els) {
          for (const c of e.classList) {
            classes.add(c);
            if (/_[a-z0-9]{5}_\d+$/.test(c)) hashClasses++;
          }
          for (const a of e.attributes) if (a.name.startsWith('data-')) dataAttrs.add(a.name);
        }
        (function d(el, depth) {
          maxDepth = Math.max(maxDepth, depth);
          for (const c of el.children) d(c, depth + 1);
        })(root, 1);
        return { elements: els.length, classes: classes.size, hashClassUses: hashClasses, dataAttrs: [...dataAttrs], maxDepth };
      }

      return {
        composer: {
          found: !!editable,
          tag: editable ? sig(editable) : null,
          tree: composerRoot ? tree(composerRoot, 0) : null,
          stats: stats(composerRoot),
        },
        sessionRow: { found: !!sessionRow, tree: sessionRow ? tree(sessionRow, 0) : null, stats: stats(sessionRow) },
        newSession: { found: !!newSessionRow, tree: newSessionRow ? tree(newSessionRow, 0) : null, stats: stats(newSessionRow) },
        main: { found: !!main, stats: stats(main) },
        whole: stats(document.getElementById('root')),
      };
    });

    writeFileSync(join(OUT, 'dom-dump.json'), JSON.stringify(dump, null, 2), 'utf8');

    console.log('\n=== 整页（#root）===');
    console.log(JSON.stringify(dump.whole));
    console.log('\n=== 输入框那一块（composer）===');
    console.log(`找到：${dump.composer.found}  最内层：${dump.composer.tag}`);
    console.log(`统计：${JSON.stringify(dump.composer.stats)}`);
    console.log('结构（前 3 层，完整见 ' + OUT + '/dom-dump.json）：');
    console.log((dump.composer.tree ?? '(没找到)').split('\n').slice(0, 42).join('\n'));

    console.log('\n=== 侧栏「新会话」按钮 ===');
    console.log(`统计：${JSON.stringify(dump.newSession.stats)}`);
    console.log((dump.newSession.tree ?? '(没找到)').split('\n').slice(0, 20).join('\n'));

    await browser.close();
  } finally {
    boot.proc.kill();
  }
  return 0;
}

process.exit(await main().catch((e) => {
  console.error(`❌ ${e.message}`);
  return 1;
}));
