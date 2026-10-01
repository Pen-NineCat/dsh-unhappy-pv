/**
 * film/lib/static-server.js — 本地静态服务器（只绑 127.0.0.1，只服务约定的目录）。
 *
 * 为什么要它（`AGENTS.md` §7 第 7 个焊点：**资源全部本地**）：
 * `film/vendor/dsh-web-frontend/index.html` 里是 `<script type="module" crossorigin>`，
 * 用 `file://` 打开会被 CORS 挡住（模块脚本 + crossorigin 在 file:// 下必失败）。
 * 所以走 HTTP —— 但**只绑回环**，而且**只允许服务白名单内的目录**（不做通用文件服务器）。
 *
 * 它同时是**诊断工具**：记录每个请求的状态码，这样「缺哪个文件」是查出来的，不是猜出来的。
 * 实测价值：T1 探针就是靠它拿到「5 个资源全 200、零 404、零失败请求」这条结论。
 *
 * 只用于本地截图，不进成片；默认端口 0（由系统分配），避免撞到别的开发服务器。
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, resolve as resolvePath, sep } from 'node:path';

/** 常见扩展名 → MIME。够用就行，不引依赖。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @typedef {Object} StaticServer
 * @property {string} url 根地址（以 `/` 结尾）
 * @property {number} port
 * @property {{url: string, status: number, type: string, ms: number}[]} requests 请求记录
 * @property {(sub: string) => string} urlFor 拼一个绝对 URL
 * @property {() => Promise<void>} close
 */

/**
 * 起一个静态服务器。
 * @param {string} dir 服务根目录（必须存在）
 * @param {{port?: number, mounts?: Record<string, string>}} [opts]
 *   `mounts`：额外挂载点，形如 `{'/vendor': 'film/vendor'}`，**挂载点优先于根目录**。
 *   ⚠️ **相对路径会按 cwd 解析**（`resolvePath`）—— 这一点踩过坑（2026-10-01）：
 *   第一版只对 `dir` 做 `resolvePath`、对 mounts **不做**，于是传相对路径时
 *   `normalize(join('film/vendor', rel))` 得到相对路径，永远匹配不上
 *   `base + sep` 这个**绝对**前缀判断 → 全部 404，而 404 的原因看起来像"文件不在"。
 *   现在两边统一解析，并且**启动时就检查 mount 目录存在**。
 * @returns {Promise<StaticServer>}
 */
export function serveStatic(dir, opts = {}) {
  const root = resolvePath(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`serveStatic: 目录不存在 ${root}`);
  }
  /** @type {Array<[string, string]>} */
  const mounts = Object.entries(opts.mounts ?? {}).map(([prefix, d]) => {
    const abs = resolvePath(d);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new Error(
        `serveStatic: 挂载点 "${prefix}" 的目录不存在 ${abs}\n` +
          `  hint: 传进来的相对路径是按 **cwd** 解析的；要么给绝对路径，要么确认 cwd 对`,
      );
    }
    return [prefix, abs];
  });
  /** @type {{url: string, status: number, type: string, ms: number}[]} */
  const requests = [];

  return new Promise((res, rej) => {
    const server = createServer((req, reply) => {
      const t0 = Date.now();
      const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const done = (/** @type {number} */ status, /** @type {string} */ type, /** @type {Buffer|string} */ body) => {
        requests.push({ url: raw, status, type, ms: Date.now() - t0 });
        reply.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
      };

      // 挂载点：最长前缀优先
      let base = root;
      let rel = raw;
      const hit = mounts
        .filter(([p]) => raw === p || raw.startsWith(p.endsWith('/') ? p : `${p}/`))
        .sort((a, b) => b[0].length - a[0].length)[0];
      if (hit) {
        base = hit[1];
        // 剥掉挂载前缀，**保留一个开头的 /**（`join` 要的是相对路径，不能以 / 开头）
        const stripped = raw.slice(hit[0].length).replace(/^\/+/, '');
        rel = `/${stripped}`;
      }

      const full = normalize(join(base, rel === '/' ? 'index.html' : rel));
      // 目录穿越保护：解析后必须仍在 base 之下。
      // ⚠️ 如果 mount 传了相对路径而 cwd 又不是仓库根，`join` 会算出一个**看起来正常**的路径
      //    但它在 base 之外 —— 这时报 403 而不是 404，好区分「穿越」与「文件真的不在」。
      if (full !== base && !full.startsWith(base + sep)) {
        done(403, 'text/plain', `forbidden (resolved outside mount): ${full}`);
        return;
      }
      if (!existsSync(full) || !statSync(full).isFile()) {
        done(404, 'text/plain', `not found: ${raw}`);
        return;
      }
      const body = readFileSync(full);
      done(200, MIME[extname(full).toLowerCase()] ?? 'application/octet-stream', body);
    });
    server.on('error', rej);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      const base = `http://127.0.0.1:${addr.port}/`;
      res({
        url: base,
        port: addr.port,
        requests,
        urlFor: (sub) => base + String(sub).replace(/^\/+/, ''),
        close: () =>
          new Promise((r) => {
            server.close(() => r(undefined));
          }),
      });
    });
  });
}

/**
 * 把请求记录汇总成可读结论（「缺哪个文件」一眼可见）。
 * @param {StaticServer['requests']} requests
 * @returns {{ok: number, bad: {url: string, status: number}[], text: string}}
 */
export function summarizeRequests(requests) {
  const bad = requests.filter((r) => r.status !== 200).map((r) => ({ url: r.url, status: r.status }));
  const ok = requests.length - bad.length;
  const lines = [`共 ${requests.length} 个请求，${ok} 个 200`];
  for (const b of bad) lines.push(`  ❌ ${b.status}  ${b.url}`);
  return { ok, bad, text: lines.join('\n') };
}
