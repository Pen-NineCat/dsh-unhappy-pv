/**
 * film/lib/dsh-web.js — 起一个**独立的** `dsh web` 并把它当素材源（R2 侧）。
 *
 * 这个模块只被**探针**用（`film/test/probe-r2.mjs`、`film/test/compare-r1-r2.mjs`），
 * 不在成片管线里 —— 成片走 R1（手搭 DOM + 抽出来的 CSS），不需要 dsh 服务在场。
 *
 * 为什么单独一个模块：R2 的启动协议（`--profile web --port 0 --no-open` + 从 stdout
 * 里解析带 token 的 URL）是**实测出来的**，不能有两份实现 —— 两份实现意味着
 * 以后 dsh 改了启动输出，只有一份会被修好。
 *
 * 关于 token 的那件事实（实测）：不带 token 抓 `/` 是 **401**。
 * 所以 URL 必须从启动输出里解析，不能手拼。
 */

import { spawn } from 'node:child_process';

/** dsh 的入口。为什么写死绝对路径：本仓库的 `node_modules` 里没有 dsh（它是全局安装的）。 */
export const DSH_BIN = 'E:\\NodeJSGlobalPackage\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js';

/**
 * Playwright 的启动参数。**必须与 `film/pages/shot.mjs` 完全一致**，
 * 否则 R1 与 R2 的截图在字体栅格化上就不可比（这是「并排比」的前提）。
 */
export const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'];

/**
 * @typedef {Object} DshWeb
 * @property {string} url 带 token 的首页地址
 * @property {string} token
 * @property {number} port
 * @property {import('node:child_process').ChildProcess} proc
 * @property {string[]} lines 启动输出（诊断用）
 * @property {() => void} kill
 */

/**
 * 起一个 dsh web，等它把带 token 的 URL 打到 stdout/stderr。
 * @param {{port?: number, timeoutMs?: number}} [opts] `port: 0` = 让系统选
 * @returns {Promise<DshWeb>}
 */
export function bootDshWeb(opts = {}) {
  const port = opts.port ?? 0;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [DSH_BIN, '--profile', 'web', '--port', String(port), '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    /** @type {string[]} */
    const lines = [];
    let done = false;
    const finish = (/** @type {'ok'|'err'} */ kind, /** @type {any} */ v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (kind === 'ok') res(v);
      else rej(v);
    };
    const timer = setTimeout(
      () => {
        proc.kill();
        finish('err', new Error(`dsh web 启动超时（${timeoutMs} ms）。已收到的输出：\n${lines.join('\n')}`));
      },
      timeoutMs,
    );

    const onData = (/** @type {Buffer} */ chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) lines.push(line.trim());
      }
      const m = /(http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+))/.exec(lines.join('\n'));
      if (m) {
        finish('ok', {
          url: m[1],
          token: m[3],
          port: Number(m[2]),
          proc,
          lines,
          kill: () => proc.kill(),
        });
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => finish('err', e));
    proc.on('exit', (code) => {
      if (!done) finish('err', new Error(`dsh web 提前退出（码 ${code}）：\n${lines.join('\n')}`));
    });
  });
}

/**
 * 打开真界面并把它**停住**（等价于七个焊点里能做的那几个）。
 *
 * 能做的：固定 viewport/dpr（焊点 6）、等字体（焊点 1）、把动画 `pause()`（焊点 3）。
 * 做不到的：焊点 4（DOM 不归我们写）、焊点 7（它自己带的资源）。
 * @param {import('playwright').Browser} browser
 * @param {DshWeb} boot
 * @param {{width: number, height: number, deviceScaleFactor: number, settleMs?: number}} view
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>}
 */
export async function openPinnedGui(browser, boot, view) {
  const page = await browser.newPage({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.deviceScaleFactor,
  });
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
  });
  await page.goto(boot.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(view.settleMs ?? 4000); // 插件自举 + 首屏渲染
  await page.evaluate(() => document.fonts.ready);
  await pinAnimations(page);
  return { page, errors };
}

/**
 * 焊点 3 在 R2 下的版本：把动画停住并把时间归零。
 * ⚠️ R2 的动画归零 = `currentTime = 0`（**不是** R1 的「按 `n` 设时间」）——
 * 真界面的时钟不是我们能设的，只能冻在第一帧。
 * @param {import('playwright').Page} page
 */
export async function pinAnimations(page) {
  return page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* 有的动画不支持设 currentTime */
      }
    }
    return document.getAnimations().length;
  });
}
