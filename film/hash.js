/**
 * film/hash.js — 帧哈希清单（`AGENTS.md` §8 的护栏之一）。
 *
 * 用途（施工说明 §7.3）：把「无法证明的跨机器确定性」变成「可度量的差异」。
 * - 同一台机器重渲 → `out/frames.sha256` 必须逐行相同
 * - 另一台机器渲染 → **允许**不同，但必须显式比对并报告差异帧数
 *
 * 清单格式：每帧一行 `n<TAB>sha256`，按 `n` 升序，行尾 `\n`。
 * 刻意用最简单、最容易 `diff` 的格式，不要 JSON（大清单要能用 PowerShell/文本工具直接比）。
 *
 * sha256 一律走 `node:crypto`（`AGENTS.md` §7：工具脚本不要自己实现 sha256）。
 */

import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { rawRGB } from './kit/pixels.js';

/**
 * 单帧哈希：对**去掉 alpha 的 RGB 字节**做 sha256。
 *
 * 用 RGB 而不是 RGBA 的原因：成片没有 alpha，两条不同的透明路径会得到同一个可见画面；
 * 哈希要盯的是「观众看到的像素」。透明像素按黑底合成，语义在 `kit/pixels.js` 里。
 * @param {any} canvas `@napi-rs/canvas` 的 `Canvas`（或 ctx）
 * @returns {string} 64 位小写十六进制
 */
export function frameHash(canvas) {
  return hashBuffer(rawRGB(canvas));
}

/**
 * 任意 buffer 的 sha256。
 * @param {Buffer|Uint8Array|string} buf
 * @returns {string}
 */
export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 文件的 sha256（分块读：母版 9.97 MB 无所谓，但保持这个习惯，别对 mp4 用整读）。
 * @param {string} path
 * @returns {string}
 */
export function hashFile(path) {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, null);
      if (got === 0) break;
      h.update(chunk.subarray(0, got));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * @typedef {Object} ManifestEntry
 * @property {number} n 帧号
 * @property {string} sha256
 */

/**
 * 序列化成清单文本。每帧一行 `n<TAB>sha256`。
 * @param {ManifestEntry[]} entries
 * @returns {string}
 */
export function formatManifest(entries) {
  const sorted = [...entries].sort((a, b) => a.n - b.n);
  return sorted.map((e) => `${e.n}\t${e.sha256}`).join('\n') + '\n';
}

/**
 * 写清单。目录不存在会自动建（`out/` 被 `.gitignore` 忽略，可以随便建）。
 * @param {ManifestEntry[]} entries
 * @param {string} path
 * @returns {{path: string, frames: number, bytes: number}}
 */
export function writeManifest(entries, path) {
  const text = formatManifest(entries);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return { path, frames: entries.length, bytes: Buffer.byteLength(text) };
}

/**
 * 读清单。格式坏了就抛（带行号），不要静默跳过。
 * @param {string} path
 * @returns {ManifestEntry[]}
 */
export function readManifest(path) {
  const text = readFileSync(path, 'utf8');
  /** @type {ManifestEntry[]} */
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const parts = line.split('\t');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) {
      throw new Error(`帧哈希清单 ${path}:${i + 1} 格式不对，期望 "n<TAB>sha256"，收到 "${line}"`);
    }
    out.push({ n: Number(parts[0]), sha256: parts[1] });
  }
  return out;
}

/**
 * 比对两份清单，报告差异帧数（施工说明 §7.3 的跨机器用法）。
 * @param {ManifestEntry[]} a
 * @param {ManifestEntry[]} b
 * @returns {{same: boolean, onlyA: number[], onlyB: number[], differing: number[], count: number}}
 */
export function compareManifests(a, b) {
  /** @type {Map<number, string>} */
  const ma = new Map(a.map((e) => [e.n, e.sha256]));
  /** @type {Map<number, string>} */
  const mb = new Map(b.map((e) => [e.n, e.sha256]));
  /** @type {number[]} */
  const onlyA = [];
  /** @type {number[]} */
  const onlyB = [];
  /** @type {number[]} */
  const differing = [];
  for (const [n, h] of ma) {
    if (!mb.has(n)) onlyA.push(n);
    else if (mb.get(n) !== h) differing.push(n);
  }
  for (const n of mb.keys()) if (!ma.has(n)) onlyB.push(n);
  const sort = (/** @type {number[]} */ v) => v.sort((x, y) => x - y);
  return {
    same: onlyA.length === 0 && onlyB.length === 0 && differing.length === 0,
    onlyA: sort(onlyA),
    onlyB: sort(onlyB),
    differing: sort(differing),
    count: onlyA.length + onlyB.length + differing.length,
  };
}

/**
 * 文件名连续无空洞断言（施工说明 §7.1 的「文件名编号连续」）。
 * @param {ManifestEntry[]} entries
 * @param {number} expected 期望帧数（通常 `FRAME_COUNT`）
 * @throws {Error}
 */
export function assertContinuous(entries, expected) {
  const ns = entries.map((e) => e.n).sort((a, b) => a - b);
  if (ns.length !== expected) {
    throw new Error(`帧哈希清单帧数不对：${ns.length} ≠ 期望 ${expected}`);
  }
  for (let i = 0; i < ns.length; i++) {
    if (ns[i] !== i) {
      throw new Error(`帧哈希清单编号不连续：第 ${i} 行是 ${ns[i]}，期望 ${i}`);
    }
  }
  return true;
}
