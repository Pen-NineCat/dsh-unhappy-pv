/**
 * film/lib/render-worker.js — 一个 worker 渲染**一段连续帧**，并把它 pipe 给自己的 ffmpeg。
 *
 * 施工说明 §5.4 的硬约束，逐条对应到代码：
 *
 * 1. **段内连续**：worker 拿到 `[n0, n1)`，从 `n0` 顺序渲到 `n1-1`，`prev` 从 `null` 起。
 *    绝不交错分配帧 —— 那样段内就不连续了，`prev` 的语义也没了。
 * 2. **喂管道前断言**：`W×H`、`rgb24`、buffer 长度 `W*H*3`。这是「花屏」事故的唯一原因。
 * 3. **背压**：`stdin.write()` 返回 `false` 时必须等 `'drain'`，
 *    否则 1920×1080×3 ≈ 6.2 MB/帧的写入速度会撑爆管道，画面撕裂。
 * 4. **不设 `-shortest`**：段文件由帧数决定长度。
 *
 * 这个文件**只被 `render-video.js` 当 worker 用**，不要当模块 import。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

import { frame } from '../engine/frame.js';
import { assertRgb24Buffer, assertSize, rawRGB } from '../kit/pixels.js';

const { n0, n1, path, ffmpeg, crf, preset, codec, fps, w, h, manifest, post, postEnable } =
  /** @type {any} */ (workerData);

/**
 * 帧哈希清单（可选）：记录**真正喂给 ffmpeg 的那些字节**的 sha256。
 *
 * 为什么要有它（Phase 3 实测出来的边界）：mp4 即使输入完全相同也**不是逐字节可复现**的 ——
 * x264 的输出取决于该帧在 GOP 里的位置，而分段数变了 GOP 结构就变了。
 * 实测：同一批帧（30..59）当作**段首**编码 vs 当作**段中**编码，
 * 解码后最大字节差 254（几乎是完全不同的一张图，因为前者是 I 帧）。
 * 所以「worker 数无关」这条验收**必须量在喂进去的帧上**，不能量在成片字节上。
 * @type {string[]}
 */
const feedHashes = [];


const total = n1 - n0;

/**
 * 编码参数。
 *
 * - `x264`（默认）：`libx264 -crf N -pix_fmt yuv420p` —— 交付向，体积小。
 * - `lossless`：`libx264rgb -qp 0 -pix_fmt rgb24` —— **逐字节无损**的母版。
 *   2026-10-01 实测（施工说明附录 C 记录 15）：编码后再解回 raw rgb24，
 *   **逐帧逐字节等于**喂进去的 buffer；同样条件下约 22.9 KB/帧
 *   （对比 ffv1 的 70.5 KB/帧）。`--preset slow` 比 `veryfast` 又小一半。
 */
const CODEC_ARGS =
  codec === 'lossless'
    ? ['-c:v', 'libx264rgb', '-qp', '0', '-preset', String(preset || 'slow'), '-pix_fmt', 'rgb24']
    : ['-c:v', 'libx264', '-crf', String(crf), '-preset', String(preset), '-pix_fmt', 'yuv420p'];

/**
 * 起 ffmpeg，把 raw rgb24 从 stdin 喂进去。
 * `stdio: ['pipe', 'ignore', 'pipe']`：stdout 不用，stderr 收起来（出错时要看）。
 */
const ff = spawn(
  ffmpeg,
  [
    '-v', 'error', '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s', `${w}x${h}`,
    '-r', String(fps),
    '-i', '-',
    ...CODEC_ARGS,
    // 段文件不需要 faststart，最终成片才加（避免每段都搬一次 moov）
    path,
  ],
  { stdio: ['pipe', 'ignore', 'pipe'] },
);

/** @type {Buffer[]} */
let stderrChunks = [];
ff.stderr?.on('data', (c) => stderrChunks.push(c));

/** 等 `drain`（背压）。 */
function writeWithBackpressure(/** @type {import('node:stream').Writable} */ stream, /** @type {Buffer} */ buf) {
  return new Promise((res, rej) => {
    const ok = stream.write(buf, (err) => {
      if (err) rej(err);
    });
    if (ok) res(undefined);
    else stream.once('drain', () => res(undefined));
  });
}

async function run() {
  for (let i = 0; i < total; i++) {
    const n = n0 + i;
    const cv = frame(n, null, { post, postEnable });

    // 断言三次：尺寸、像素格式（rgb24 布局）、buffer 长度
    assertSize(cv, w, h, `frame(${n})`);
    const buf = rawRGB(cv);
    assertRgb24Buffer(buf, w, h, `frame(${n}) 的 rgb24 buffer`);

    if (manifest) feedHashes.push(`${n}\t${createHash('sha256').update(buf).digest('hex')}`);

    await writeWithBackpressure(ff.stdin, buf);

    if (parentPort && (i % 24 === 0 || i === total - 1)) {
      parentPort.postMessage({ type: 'progress', done: i + 1, total });
    }
  }

  await new Promise((res, rej) => {
    ff.stdin.end(() => res(undefined));
    ff.on('error', rej);
  });

  const code = await new Promise((res) => ff.on('close', (c) => res(c ?? -1)));
  if (code !== 0) {
    const err = Buffer.concat(stderrChunks).toString('utf8').trim().split('\n').slice(-12).join('\n');
    throw new Error(`ffmpeg 段编码失败（帧 ${n0}..${n1 - 1}，退出码 ${code}）：\n${err}`);
  }
  parentPort?.postMessage({ type: 'done', from: n0, to: n1, path, feedHashes });
}

try {
  await run();
  process.exit(0);
} catch (e) {
  // 把错误发回去，主线程才拿得到真实原因（worker 的未捕获异常只有一行栈）
  parentPort?.postMessage({
    type: 'error',
    message: `${/** @type {Error} */ (e).message}`,
  });
  console.error(/** @type {Error} */ (e).stack ?? String(e));
  process.exit(1);
}
