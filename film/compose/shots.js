/**
 * film/compose/shots.js — 截图的**取用与缺帧报错**（Phase 6 第 5 条）。
 *
 * 纪律（施工说明 §6 Phase 6 第 5 条）：
 * **缺帧要报错，不要静默跳过**。参考项目此处会抛，我们保持这个行为，
 * 而且错误信息必须**指出帧号与轨道**（`AGENTS.md` §8：护栏的价值取决于报错好不好定位）。
 *
 * 静默跳过的后果很具体：`film/compose/overlay.js` 会把「没有截图」当成「这一帧没有这一层」，
 * 于是**整层消失**，而 4741 帧里少一层的画面要人眼去抽查才可能发现。
 *
 * 文件名约定：`<帧号5位>-<轨道>.png`（如 `00240-dsh.png`）。
 * 帧号用 5 位零填充，这样按文件名排序 == 按帧号排序（`AGENTS.md` §2 规则 5：帧号是唯一主键）。
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} ShotSource
 * @property {string} dir 截图目录
 * @property {(n: number, track: string) => string} pathFor 帧号+轨道 → 文件路径
 * @property {(n: number, track: string) => boolean} has 这一帧有没有
 * @property {(n: number, track: string) => Promise<import('@napi-rs/canvas').Canvas>} load 取一帧（缺失则抛）
 * @property {() => {hits: number, loads: number, misses: string[]}} stats 缓存命中统计
 */

/**
 * 打开一个截图目录。
 *
 * 刻意**不**在打开时扫描整个目录建索引：那是 O(4741)，而且会让「缺帧」这件事故意变得不显眼
 * （先扫一遍再按索引查，缺帧就变成一次查表失败）。直接按约定算路径、直接看它在不在。
 * @param {string} dir
 * @param {{track?: string, canvas?: (w: number, h: number) => any}} [opts]
 * @returns {ShotSource}
 */
export function openShotSource(dir, opts = {}) {
  if (!existsSync(dir)) {
    throw new Error(
      `截图目录不存在：${dir}\n` +
        `  hint: 先跑 node film/pages/gen-frames.js && node film/pages/shot.mjs`,
    );
  }
  /** @type {Map<string, import('@napi-rs/canvas').Canvas>} */
  const cache = new Map();
  const stats = { hits: 0, loads: 0, misses: /** @type {string[]} */ ([]) };
  // 缓存有界：4741 帧 × N 轨道全留在内存里不现实（1920×1280 RGBA ≈ 9.8 MB/张）
  const capacity = 64;

  /** @param {number} n @param {string} track */
  const pathFor = (n, track) => join(dir, `${String(n).padStart(5, '0')}-${track}.png`);

  return {
    dir,
    pathFor,
    has: (n, track) => existsSync(pathFor(n, track)),
    async load(n, track) {
      const p = pathFor(n, track);
      const key = `${n}|${track}`;
      const hit = cache.get(key);
      if (hit) {
        stats.hits++;
        return hit;
      }
      if (!existsSync(p)) {
        const msg = `缺截图：帧 ${n} 轨道 ${track} → ${p}`;
        stats.misses.push(msg);
        throw new Error(
          `${msg}\n` +
            `  hint: 不要静默跳过 —— 缺一帧会让这一层整帧消失，肉眼很难发现\n` +
            `        重截：node film/pages/shot.mjs --frames ${n}`,
        );
      }
      const png = readFileSync(p);
      const img = await loadImage(png);
      const cv = createCanvas(img.width, img.height);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      stats.loads++;
      cache.set(key, cv);
      if (cache.size > capacity) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return cv;
    },
    stats: () => ({ ...stats, misses: [...stats.misses] }),
    ...(opts.canvas ? {} : {}),
  };
}

/**
 * 一个**内存里的**截图源（测试/合成验证用，不落盘）。
 *
 * 刻意与 `openShotSource` 同接口 —— 这样「缺帧报错」「1:1 贴入」「镜头运动」这些
 * 验收都能在**不跑浏览器**的情况下测掉。
 * @param {Map<string, any>} images 键 `"<n>|<track>"`
 * @returns {ShotSource}
 */
export function memoryShotSource(images) {
  const stats = { hits: 0, loads: 0, misses: /** @type {string[]} */ ([]) };
  return {
    dir: '(memory)',
    pathFor: (n, track) => `memory://${n}-${track}`,
    has: (n, track) => images.has(`${n}|${track}`),
    async load(n, track) {
      const key = `${n}|${track}`;
      const hit = images.get(key);
      if (!hit) {
        const msg = `缺截图：帧 ${n} 轨道 ${track} → memory://${n}-${track}`;
        stats.misses.push(msg);
        throw new Error(`${msg}\n  hint: 不要静默跳过 —— 缺一帧会让这一层整帧消失`);
      }
      stats.loads++;
      return hit;
    },
    stats: () => ({ ...stats, misses: [...stats.misses] }),
  };
}

/**
 * 断言「某一帧区间里每个轨道都有截图」，并把缺失的**一次列全**
 * （比让它后续在某一帧炸掉更好定位）。
 * @param {ShotSource} src
 * @param {number} n0 含 @param {number} n1 不含
 * @param {readonly string[]} tracks
 * @throws {Error} 有缺失时抛出，列出前若干个缺失帧号
 */
export function assertShotsPresent(src, n0, n1, tracks) {
  /** @type {{n: number, track: string}[]} */
  const missing = [];
  for (let n = n0; n < n1; n++) {
    for (const t of tracks) {
      if (!src.has(n, t)) missing.push({ n, track: t });
    }
  }
  if (missing.length === 0) return true;
  const head = missing.slice(0, 10).map((m) => `n=${m.n} ${m.track}`).join('、');
  throw new Error(
    `截图不全：[${n0}, ${n1}) × ${tracks.join('/')} 缺 ${missing.length} 张\n` +
      `  前几个：${head}${missing.length > 10 ? ' …' : ''}\n` +
      `  hint: node film/pages/shot.mjs --range ${n0} ${n1 - 1}`,
  );
}
