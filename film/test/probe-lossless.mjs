/**
 * film/test/probe-lossless.mjs — 验证「无损母版」编码是真的无损（Phase 7 探针）。
 *
 * 判据：`libx264rgb -qp 0 -pix_fmt rgb24` 编码后再用 ffmpeg 解回 raw rgb24，
 * **逐字节**等于喂进去的 buffer。这是「无损」这个词唯一有意义的定义。
 *
 * 用法：node film/test/probe-lossless.mjs [帧数]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { H, W } from '../engine/clock.js';
import { frame } from '../engine/frame.js';
import { rawRGB } from '../kit/pixels.js';
import { resolveFfmpegTools } from '../lib/ffmpeg-path.js';

const N = Number(process.argv[2] ?? 12);
const TMP = 'out/_lossless_probe';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const { ffmpeg, ffprobe } = resolveFfmpegTools();
const ff = ffmpeg.path;
console.log(`ffmpeg ${ff}`);
console.log(`帧数   ${N}（${W}×${H}）`);

// 1) 生成 N 帧并记录它们的 sha256（这就是「原始像素」）
const { createHash } = await import('node:crypto');
/** @type {Buffer[]} */
const frames = [];
/** @type {string[]} */
const hashes = [];
for (let n = 0; n < N; n++) {
  const buf = rawRGB(frame(n, null, { postEnable: { trail: false, bloom: false, scanlines: false, vignette: false } }));
  frames.push(buf);
  hashes.push(createHash('sha256').update(buf).digest('hex'));
}
const all = Buffer.concat(frames);
writeFileSync(join(TMP, 'in.raw'), all);
console.log(`输入   ${all.length} 字节，逐帧 sha256 已记（例如 ${hashes[0].slice(0, 16)}…）`);

/**
 * 跑一次编码 + 解码，返回解回来的逐帧 sha256。
 * @param {string} label @param {string[]} args
 */
function roundTrip(label, args) {
  const outFile = join(TMP, `${label}.mkv`);
  const r1 = spawnSync(
    ff,
    [
      '-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '24', '-i', join(TMP, 'in.raw'),
      ...args,
      outFile,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r1.status !== 0) {
    console.log(`  ${label}: ❌ 编码失败\n    ${(r1.stderr ?? '').trim().split('\n').slice(-4).join('\n    ')}`);
    return null;
  }
  const rawOut = join(TMP, `${label}.raw`);
  const r2 = spawnSync(
    ff,
    ['-v', 'error', '-y', '-i', outFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawOut],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r2.status !== 0) {
    console.log(`  ${label}: ❌ 解码失败`);
    return null;
  }
  const back = readFileSync(rawOut);
  const size = statSync(outFile).size;
  const expect = W * H * 3 * N;
  if (back.length !== expect) {
    console.log(`  ${label}: ⚠️ 解回来 ${back.length} 字节 ≠ ${expect}`);
  }
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < N; i++) {
    const s = i * W * H * 3;
    out.push(createHash('sha256').update(back.subarray(s, s + W * H * 3)).digest('hex'));
  }
  const same = out.every((h, i) => h === hashes[i]);
  console.log(
    `  ${label}: ${same ? '✅ 逐帧逐字节相同' : '❌ 有差异'}   ${(size / 1024 / 1024).toFixed(2)} MB  ` +
      `${(size / N / 1024).toFixed(1)} KB/帧`,
  );
  if (!same) {
    const bad = out.findIndex((h, i) => h !== hashes[i]);
    console.log(`      首个不同的帧：${bad}`);
  }
  return { label, same, size };
}

console.log('\n候选编码：');
const results = [
  roundTrip('cropped-ffv1', ['-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0', '-coder', '1', '-context', '1', '-g', '1']),
  roundTrip('ffv1', ['-c:v', 'ffv1', '-pix_fmt', 'bgr0', '-coder', '1', '-context', '1', '-g', '1']),
  roundTrip('x264rgb-qp0', ['-c:v', 'libx264rgb', '-qp', '0', '-preset', 'veryfast', '-pix_fmt', 'rgb24']),
  roundTrip('x264rgb-qp0-tune', ['-c:v', 'libx264rgb', '-qp', '0', '-preset', 'slow', '-pix_fmt', 'rgb24']),
].filter(Boolean);

console.log('\n结论：');
for (const r of results ?? []) {
  console.log(`  ${r?.same ? '✅' : '❌'} ${r?.label}  ${((r?.size ?? 0) / 1024 / 1024).toFixed(2)} MB`);
}
rmSync(TMP, { recursive: true, force: true });
void ffprobe;
