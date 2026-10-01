/**
 * film/test/lossless.test.js — Phase 7 验收：**无损母版真的无损**。
 *
 * 判据（唯一有意义的定义）：`libx264rgb -qp 0 -pix_fmt rgb24` 编码后再解回 raw rgb24，
 * **逐帧逐字节**等于喂进去的 buffer。
 *
 * 这条测试刻意**不**自己造帧：它拿 `film/lib/render-worker.js` **真正喂进 ffmpeg 的那些字节**
 * 来比 —— 也就是走完整条链路（`frame()` → `rawRGB()` → ffmpeg → 解码 → 哈希），
 * 而不是比一个我自己摆出来的中间态。
 *
 * 要跑它需要 ffmpeg（本机在 `E:\ffmpeg\bin`，三级解析见 `film/lib/ffmpeg-path.js`）。
 * 没有 ffmpeg 时**明确跳过**，不假装通过。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { H, W } from '../engine/clock.js';
import { frame } from '../engine/frame.js';
import { rawRGB } from '../kit/pixels.js';
import { resolveFfmpegTools } from '../lib/ffmpeg-path.js';
import { describe, eq, ok, test } from './_harness.js';

const TMP = 'out/_lossless_test';
const N = 6;

/** @returns {{ff: string, ok: boolean}} */
function ffmpegOrSkip() {
  try {
    const { ffmpeg } = resolveFfmpegTools();
    if (ffmpeg.via === 'unresolved' || (ffmpeg.version ?? '').startsWith('❌')) {
      return { ff: '', ok: false };
    }
    return { ff: ffmpeg.path, ok: true };
  } catch {
    return { ff: '', ok: false };
  }
}

/**
 * 走一遍「帧 → raw → 编码 → 解码」，返回两侧的逐帧 sha256。
 * @param {string} ff @param {string} label @param {string[]} codecArgs
 */
function roundTrip(ff, label, codecArgs) {
  const inRaw = join(TMP, 'in.raw');
  const mk = join(TMP, `${label}.mkv`);
  const outRaw = join(TMP, `${label}.raw`);

  const r1 = spawnSync(
    ff,
    ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '24', '-i', inRaw, ...codecArgs, mk],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r1.status !== 0) throw new Error(`编码失败：${(r1.stderr ?? '').slice(-300)}`);
  const r2 = spawnSync(ff, ['-v', 'error', '-y', '-i', mk, '-f', 'rawvideo', '-pix_fmt', 'rgb24', outRaw], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r2.status !== 0) throw new Error(`解码失败：${(r2.stderr ?? '').slice(-300)}`);

  const back = readFileSync(outRaw);
  /** @type {string[]} */
  const hashes = [];
  for (let i = 0; i < N; i++) {
    const s = i * W * H * 3;
    hashes.push(createHash('sha256').update(back.subarray(s, s + W * H * 3)).digest('hex'));
  }
  return { hashes, bytes: readFileSync(mk).length };
}

describe('Phase 7 · 无损母版（libx264rgb -qp 0）', () => {
  // ⚠️ 别把这个对象解构成 `ok` —— 会**遮蔽** `_harness` 里的断言函数 `ok()`，
  //    症状是后面所有 `ok(...)` 报 "ok is not a function"（实测踩过）
  const probe = ffmpegOrSkip();
  const ff = probe.ff;
  const ffAvailable = probe.ok;

  test('编码→解码后逐帧逐字节等于喂进去的 buffer', () => {
    if (!ffAvailable) {
      console.log('       （跳过：本机没有可用的 ffmpeg）');
      return;
    }
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });

    // 1) 造帧 —— **和成片走同一条路**：frame() → rawRGB()（带后期默认值）
    /** @type {Buffer[]} */
    const frames = [];
    /** @type {string[]} */
    const want = [];
    for (let n = 0; n < N; n++) {
      const buf = rawRGB(frame(n));
      frames.push(buf);
      want.push(createHash('sha256').update(buf).digest('hex'));
    }
    writeFileSync(join(TMP, 'in.raw'), Buffer.concat(frames));

    // 2) 无损编码 + 解码
    const got = roundTrip(ff, 'lossless', [
      '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'slow', '-pix_fmt', 'rgb24',
    ]);

    // 3) 逐帧比
    for (let i = 0; i < N; i++) {
      eq(got.hashes[i], want[i], `第 ${i} 帧（无损母版）`);
    }
    ok(got.bytes > 0, `母版文件该非空（${got.bytes} 字节）`);

    // 4) 顺便记下体积，好在文档里对比
    const perFrameKB = got.bytes / N / 1024;
    ok(perFrameKB > 1 && perFrameKB < 4096, `每帧体积该在合理范围，实际 ${perFrameKB.toFixed(1)} KB/帧`);
    console.log(`       无损母版实测 ${perFrameKB.toFixed(1)} KB/帧（${N} 帧）`);

    rmSync(TMP, { recursive: true, force: true });
  });

  test('ffv1 也是无损的（备选格式，体积更大）', () => {
    if (!ffAvailable) return;
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    /** @type {Buffer[]} */
    const frames = [];
    /** @type {string[]} */
    const want = [];
    for (let n = 0; n < N; n++) {
      const buf = rawRGB(frame(n));
      frames.push(buf);
      want.push(createHash('sha256').update(buf).digest('hex'));
    }
    writeFileSync(join(TMP, 'in.raw'), Buffer.concat(frames));
    const got = roundTrip(ff, 'ffv1', ['-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', '-coder', '1', '-context', '1', '-g', '1']);
    for (let i = 0; i < N; i++) eq(got.hashes[i], want[i], `第 ${i} 帧（ffv1）`);
    rmSync(TMP, { recursive: true, force: true });
  });

  test('有损编码（crf 16）**不该**逐字节相同 —— 反证这条测试是有效的', () => {
    if (!ffAvailable) return;
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    /** @type {Buffer[]} */
    const frames = [];
    /** @type {string[]} */
    const want = [];
    for (let n = 0; n < N; n++) {
      const buf = rawRGB(frame(n));
      frames.push(buf);
      want.push(createHash('sha256').update(buf).digest('hex'));
    }
    writeFileSync(join(TMP, 'in.raw'), Buffer.concat(frames));
    const got = roundTrip(ff, 'lossy', ['-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']);
    const same = got.hashes.filter((h, i) => h === want[i]).length;
    ok(
      same < N,
      `有损编码本该至少有一帧不同（否则这个测试证明不了「无损」与「有损」的区别），实际 ${same}/${N} 相同`,
    );
    console.log(`       crf16 有损：${N - same}/${N} 帧与原始不同（预期如此）`);
    rmSync(TMP, { recursive: true, force: true });
  });

  test('本机 ffmpeg 可用（否则上面几条都是跳过）', () => {
    // 这条**不**跳过：它明确告诉你上面那几条到底跑了没有
    ok(existsSync('film/lib/ffmpeg-path.js'), 'ffmpeg-path 模块该在');
    console.log(`       ffmpeg ${ffAvailable ? `可用：${ff}` : '**不可用** —— 上面三条都被跳过了'}`);
  });
});
