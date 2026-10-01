#!/usr/bin/env node
/**
 * tools/trim-song.mjs — 把原曲尾部的「小数帧」删掉，得到成片所对齐的母版。
 *
 * 这是 `tools/trim_song.py` 的 **Node 移植**（Phase 1，施工说明 §6）。
 * 目标是让仓库**不再需要 Python 解释器**：`tools/trim_song.py` 是最后一处 Python 运行时依赖。
 *
 * 移植纪律（施工说明 §6 Phase 1）
 * ------------------------------
 * 1. **逐字节对拍**：产出必须与 Python 版完全一致 ——
 *    sha256 `d60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8`、
 *    字节数 `9,971,148`、`check` 三种输入退出码一致、母版是原曲的字节前缀。
 *    对拍脚本：`node tools/trim-song-parity.mjs`（需要系统 Python）。
 * 2. 只做**字节级 MPEG 帧头解析**，不涉及任何 Python 特有库。
 * 3. sha256 用 `node:crypto`，**不要自己实现**（`AGENTS.md` §7）。
 * 4. 行为、退出码、打印文本尽量与 Python 版保持一致，好让对拍只比「产物 + 退出码」。
 *
 * 做法：**字节级截断，不重编码**。MP3 帧长固定（48 kHz、1152 采样/帧、320 kbps → 960 字节/帧），
 * 保留 ID3v2 标签 + 前 k 个 MPEG 帧、丢掉其余字节即可。不重编码的收益是：同一份原曲在任何机器、
 * 任何 ffmpeg 版本下都得到同一个 sha256 —— 这是「两步校验」能成立的前提。
 * 代价是母版仍然是原文件的**字节前缀**（这条性质本身也可以用来手工复核）：
 *
 *     sha256(原曲前 N 字节) == 母版的 sha256
 *
 * k 的取法：让音频**盖住**整数个视频帧。取满足 k*spf/sr >= floor(dur*FPS)/FPS 的最小 k
 * （向下取整后再补一帧），音频最多比视频长一个 MP3 帧（24 ms）。宁可多不能少：
 * 音频短于视频时 `-shortest` 会把最后几个视频帧一起切掉。
 *
 * 已知的原件怪癖（本工具会打印出来）：这个文件的 Xing/Info 头里 `frames` 字段是 8231，
 * 而 `bytes` 字段等于 8232 帧的字节数 —— 两个字段自身差一帧。默认**不动头部**（保持字节前缀性质），
 * 需要把头部改成自洽的可以用 `--patch-info`（会改变 sha256，二者只能选一个并固定在 Resource/song.json）。
 *
 * 用法：
 *
 *     # 生成母版，并打印可直接粘进 Resource/song.json 的 JSON
 *     node tools/trim-song.mjs make --src input/song.mp3 --out input/song.master.mp3 --fps 24
 *
 *     # 两步校验：1) 原曲 sha256  2) 母版 sha256（附字节前缀结构检查）
 *     node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3
 *
 * 退出码：0 通过（原曲不匹配只是警告）；1 母版不匹配/结构不符；2 用法错误。
 */

import { createHash } from 'node:crypto';
import { openSync, closeSync, readSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── MPEG Audio 表（与 trim_song.py 逐项一致）──────────────────────────────
// 比特率表（kbps），键为 (version_key, layer)；version_key 3 = MPEG1，2 = MPEG2/2.5
const BITRATES = new Map([
  ['3,1', [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]],
  ['3,2', [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]],
  ['3,3', [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]],
  ['2,1', [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]],
  ['2,2', [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]],
  ['2,3', [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]],
]);
const SAMPLE_RATES = [
  [11025, 12000, 8000],
  [0, 0, 0],
  [22050, 24000, 16000],
  [44100, 48000, 32000],
];

/**
 * 文件的 sha256（分块读，别把整首歌一次读两遍进内存）。
 * @param {string} path
 * @returns {string}
 */
function sha256File(path) {
  const fd = openSync(path, 'r');
  const h = createHash('sha256');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      h.update(chunk.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * 解析一个 MPEG 音频帧头。读不到合法帧头时返回 `null`。
 * @param {Buffer} buf
 * @param {number} i 帧头起始偏移
 * @returns {?{bitrate: number, sample_rate: number, samples: number, length: number, channels: number, mpeg_version: number, layer: number}}
 */
export function parseFrameHeader(buf, i) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const h = buf.subarray(i, i + 4);
  const verBits = (h[1] >> 3) & 0x03;
  const layerBits = (h[1] >> 1) & 0x03;
  const brIdx = (h[2] >> 4) & 0x0f;
  const srIdx = (h[2] >> 2) & 0x03;
  if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const layer = 4 - layerBits;
  const key = `${verBits === 3 ? 3 : 2},${layer}`;
  const row = BITRATES.get(key);
  if (!row) return null;
  const bitrate = row[brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[verBits][srIdx];
  const pad = (h[2] >> 1) & 1;
  let samples;
  let length;
  if (layer === 1) {
    samples = 384;
    length = Math.trunc((12 * bitrate) / sampleRate + pad) * 4;
  } else if (layer === 2) {
    samples = 1152;
    length = Math.trunc((144 * bitrate) / sampleRate + pad);
  } else {
    samples = verBits === 2 ? 576 : 1152;
    length = Math.trunc(((samples / 8) * bitrate) / sampleRate + pad);
  }
  if (verBits === 0) samples = Math.trunc(samples / 2); // MPEG 2.5
  if (length <= 4) return null;
  return {
    bitrate,
    sample_rate: sampleRate,
    samples,
    length,
    channels: ((h[3] >> 6) & 0x03) === 3 ? 1 : 2,
    mpeg_version: verBits,
    layer,
  };
}

/**
 * @param {Buffer} b
 * @returns {number}
 */
function syncsafe(b) {
  return ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f);
}

/**
 * ID3v2 之后的音频起点。
 *
 * v2.3 的长度字段理论上不是 syncsafe，实测两种写法都有，所以两种都算，
 * 取「后面真能读出 MPEG 帧头」的那个（与 Python 版一致）。
 * @param {Buffer} data
 * @returns {{offset: number, info: Record<string, any>}}
 */
export function id3v2Offset(data) {
  if (data.subarray(0, 3).toString('latin1') !== 'ID3') return { offset: 0, info: { present: false } };
  const flags = data[5];
  /** @type {Record<string, any>} */
  const info = { present: true, version: `2.${data[3]}`, flags };
  for (const [label, size] of [
    ['syncsafe', syncsafe(data.subarray(6, 10))],
    ['plain', data.readUInt32BE(6)],
  ]) {
    const off = 10 + size + (flags & 0x10 ? 10 : 0);
    if (off + 4 <= data.length && parseFrameHeader(data, off)) {
      info.bytes = off;
      info.size_field = label;
      return { offset: off, info };
    }
  }
  const off = 10 + syncsafe(data.subarray(6, 10));
  info.bytes = off;
  info.size_field = 'syncsafe（其后读不到 MPEG 帧头）';
  return { offset: off, info };
}

/**
 * 在第一帧内部找 Xing/Info 头并解出它的字段。
 * @param {Buffer} data
 * @param {number} frameOffset
 * @param {{length: number}} head
 * @returns {?Record<string, any>}
 */
export function parseXing(data, frameOffset, head) {
  const limit = Math.min(frameOffset + head.length, data.length);
  for (const tag of ['Xing', 'Info']) {
    const at = data.indexOf(tag, frameOffset + 4);
    if (at < 0 || at >= limit) continue;
    const flags = at + 8 <= data.length ? data.readUInt32BE(at + 4) : 0;
    let pos = at + 8;
    /** @type {Record<string, any>} */
    const out = { tag, offset_in_frame: at - frameOffset, flags };
    if (flags & 1 && pos + 4 <= data.length) {
      out.frames = data.readUInt32BE(pos);
      out.frames_offset = pos;
      pos += 4;
    }
    if (flags & 2 && pos + 4 <= data.length) {
      out.bytes = data.readUInt32BE(pos);
      out.bytes_offset = pos;
      pos += 4;
    }
    if (flags & 4) pos += 100;
    if (flags & 8 && pos + 4 <= data.length) out.quality = data.readUInt32BE(pos);
    return out;
  }
  return null;
}

/**
 * 顺序走一遍 MPEG 帧。
 * @param {Buffer} data
 * @param {number} start
 * @returns {{offsets: number[], first: ?ReturnType<typeof parseFrameHeader>, end: number}}
 */
export function scanFrames(data, start) {
  /** @type {number[]} */
  const offsets = [];
  /** @type {?ReturnType<typeof parseFrameHeader>} */
  let first = null;
  let cur = start;
  while (cur + 4 <= data.length) {
    const head = parseFrameHeader(data, cur);
    if (head === null) break;
    if (first === null) first = head;
    else if (head.sample_rate !== first.sample_rate || head.samples !== first.samples) break; // 采样率/帧长变了，不再算同一段流
    offsets.push(cur);
    cur += head.length;
  }
  return { offsets, first, end: cur };
}

/**
 * 规划截断：算出保留几个 MPEG 帧、截在哪一字节。
 * @param {Buffer} data
 * @param {number} fps
 * @returns {Record<string, any>}
 */
export function plan(data, fps) {
  const { offset: tagBytes, info: tagInfo } = id3v2Offset(data);
  const { offsets, first: head, end } = scanFrames(data, tagBytes);
  if (offsets.length === 0 || head === null) {
    throw new UsageError('错误：ID3v2 之后读不到 MPEG 音频帧，这个文件可能不是 MP3。');
  }

  const spf = head.samples;
  const sr = head.sample_rate;
  const nFrames = offsets.length;
  const duration = (nFrames * spf) / sr;
  const videoFrames = Math.trunc(duration * fps); // 尾部小数帧丢掉
  const targetEnd = videoFrames ? videoFrames / fps : duration;
  let keep = Math.ceil(Math.round(targetEnd * sr) / spf); // ceil：音频必须盖住整数个视频帧
  keep = Math.max(1, Math.min(keep, nFrames));

  const xing = parseXing(data, offsets[0], head);
  let frameBytes = end - offsets[offsets.length - 1];
  for (let i = 0; i < offsets.length - 1; i++) frameBytes += offsets[i + 1] - offsets[i];

  return {
    id3v2: tagInfo,
    audio_start: tagBytes,
    trailing_bytes: data.length - end,
    first_frame: head,
    mp3_frames: nFrames,
    frame_bytes: frameBytes,
    duration_s: round6(duration),
    video_frames: videoFrames,
    target_end_s: round6(targetEnd),
    keep_frames: keep,
    trimmed_duration_s: round6((keep * spf) / sr),
    overshoot_s: round6((keep * spf) / sr - targetEnd),
    cut_at: keep < nFrames ? offsets[keep] : end,
    dropped_bytes: data.length - (keep < nFrames ? offsets[keep] : end),
    xing,
  };
}

/**
 * 把 Xing/Info 的 frames / bytes 两个字段改成自洽的值。返回改动的说明（没变的字段不报）。
 * @param {Buffer} buf 就地修改
 * @param {Record<string, any>} xing
 * @param {number} frames
 * @param {number} streamBytes
 * @returns {string[]}
 */
export function patchXing(buf, xing, frames, streamBytes) {
  const done = [];
  for (const [key, value, offsetKey] of [
    ['frames', frames, 'frames_offset'],
    ['bytes', streamBytes, 'bytes_offset'],
  ]) {
    const off = xing[offsetKey];
    if (off === undefined || xing[key] === value) continue;
    buf.writeUInt32BE(value >>> 0, off);
    done.push(`${key} ${xing[key]} → ${value}`);
  }
  return done;
}

/**
 * 解析 `--fps`。
 *
 * 注意一个**对拍出来的**差异：Python 版 `type=float` 会把 `24` 变成 `24.0`，
 * 所以它的 `make` 输出里是 `"fps": 24.0`；JS 的数字没有 int/float 之分，
 * `Number('24')` 打印出来是 `24`。这条差异**只影响打印文本，不影响任何产物字节**，
 * 所以按 JS 的写法走，不为了逐字符一致去伪造 `24.0`
 * （结论记在施工说明附录 C）。
 * @param {string} raw
 * @returns {number}
 */
function parseFps(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new UsageError('--fps 必须是个正数');
  return v;
}

/**
 * @param {number} v
 * @returns {number}
 */
function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

class UsageError extends Error {}

// ── 子命令 ────────────────────────────────────────────────────────────────

/**
 * @param {{src: string, out: string, fps: number, patchInfo: boolean}} args
 * @returns {number}
 */
export function cmdMake(args) {
  const data = readFileSync(args.src);
  const p = plan(data, args.fps);
  const cut = p.cut_at;
  const kept = Buffer.from(data.subarray(0, cut));
  const frameLen = p.first_frame.length;

  if (args.patchInfo) {
    if (p.xing) {
      const changed = patchXing(kept, p.xing, p.keep_frames, p.keep_frames * frameLen);
      console.log(`已改 Xing/Info 头（自洽化，仅描述母版）：${changed.join('; ')}`);
    } else {
      console.log('--patch-info：这个文件没有 Xing/Info 头，未做改动。');
    }
  }
  writeFileSync(args.out, kept);
  const srcSha = sha256File(args.src);
  const outSha = sha256File(args.out);

  const fps = args.fps;
  console.log(
    `原曲  ${p.duration_s} s = ${p.mp3_frames} MPEG 帧 = ${(p.duration_s * fps).toFixed(3)} 视频帧 @${fps}fps`,
  );
  console.log(`目标  ${p.video_frames} 个整数视频帧，末帧时间 ${p.target_end_s} s`);
  console.log(
    `母版  保留前 ${p.keep_frames} 个 MPEG 帧 = ${p.trimmed_duration_s} s` +
      `（比目标多 ${(p.overshoot_s * 1000).toFixed(2)} ms），丢弃 ${p.dropped_bytes} 字节`,
  );
  console.log(`      母版 = 原曲前 ${cut} 字节（字节前缀，可用 sha256(原曲[:${cut}]) 手工复核）`);
  const x = p.xing;
  if (x) {
    const implied = frameLen ? Math.floor((x.bytes ?? 0) / frameLen) : null;
    console.log(
      `注意  Xing/Info 头：tag=${x.tag} frames=${x.frames} bytes=${x.bytes}` +
        `（bytes ÷ 帧长 = ${implied} 帧，但 frames 自称 ${x.frames} 帧 → 原件头部自身差一帧）`,
    );
    if (!args.patchInfo) {
      console.log(
        `      默认不改头部：头部 bytes 字段仍是原件整段音频的 ${x.bytes} 字节` +
          `（母版实际 ${p.keep_frames * frameLen}），` +
          `所以按字节估算长度的解码器会把母版报成原长，多出 24 ms（不影响 -shortest 下的成片）。`,
      );
      console.log('      要让头部自洽：加 --patch-info（会得到另一个 sha256，只能选一个固定下来）。');
    }
  }
  console.log(`\n两步校验 sha256:\n  原曲 ${srcSha}\n  母版 ${outSha}`);

  const block = {
    source: {
      sha256: srcSha,
      duration_s: p.duration_s,
      mp3_frames: p.mp3_frames,
      bytes: statSync(args.src).size,
    },
    master: {
      sha256: outSha,
      duration_s: p.trimmed_duration_s,
      mp3_frames: p.keep_frames,
      bytes: statSync(args.out).size,
      video_frames: p.video_frames,
      fps,
      overshoot_s: p.overshoot_s,
      made_by: 'tools/trim_song.py',
      xing_patched: Boolean(args.patchInfo && x),
    },
  };
  console.log('\n--- 可粘进 Resource/song.json ---');
  console.log(JSON.stringify(block, null, 2));
  return 0;
}

/**
 * @param {{src: string, master: ?string, resource: string, srcRequired: boolean}} args
 * @returns {number}
 */
export function cmdCheck(args) {
  const spec = JSON.parse(readFileSync(args.resource, 'utf8'));
  let code = 0;
  let srcExists = false;
  try {
    srcExists = statSync(args.src).isFile();
  } catch {
    srcExists = false;
  }

  if (srcExists) {
    const got = sha256File(args.src);
    const want = String(spec.source.sha256);
    if (got.toLowerCase() === want.toLowerCase()) {
      console.log(`[1/2] 原曲 sha256 匹配：${got}`);
    } else {
      console.log(`[1/2] 警告：原曲 sha256 不匹配，唱词与切点可能漂移\n      实际 ${got}\n      期望 ${want}`);
    }
  } else if (args.srcRequired) {
    console.log(`[1/2] 错误：找不到原曲 ${args.src}`);
    code = 1;
  } else {
    console.log(`[1/2] 跳过：${args.src} 不在本机（原曲只在本地，仓库里只有它的 sha256）`);
  }

  if (!args.master) {
    console.log('[2/2] 跳过：没有给 --master（母版只在本机，仓库里只有它的 sha256）');
    return code;
  }

  let masterStat;
  try {
    masterStat = statSync(args.master);
    if (!masterStat.isFile()) throw new Error('not a file');
  } catch {
    console.log(`[2/2] 错误：找不到母版 ${args.master}`);
    return 1;
  }
  const got = sha256File(args.master);
  const want = String(spec.master.sha256);
  if (got.toLowerCase() === want.toLowerCase()) {
    console.log(`[2/2] 母版 sha256 匹配：${got}`);
  } else {
    console.log(
      `[2/2] 错误：母版 sha256 不匹配 —— 时间轴不可信，不要出片\n` +
        `      实际 ${got}\n      期望 ${want}\n` +
        `      重新生成：node tools/trim-song.mjs make --src <原曲> --out <母版>` +
        ` --fps ${Number(spec.master.fps)}`,
    );
    code = 1;
  }

  if (srcExists && masterStat.size <= statSync(args.src).size) {
    const n = masterStat.size;
    const ok = isBytePrefix(args.src, args.master, n);
    console.log(`[结构] 母版是原曲的字节前缀（前 ${n} 字节）：${ok ? '通过' : '不符'}`);
    code = code || (ok ? 0 : 1);
  }
  return code;
}

/**
 * 母版是不是原曲的前 n 字节（分块比，不整读）。
 * @param {string} srcPath
 * @param {string} masterPath
 * @param {number} n
 * @returns {boolean}
 */
function isBytePrefix(srcPath, masterPath, n) {
  const fs = openSync(srcPath, 'r');
  const fm = openSync(masterPath, 'r');
  try {
    const A = Buffer.allocUnsafe(1 << 20);
    const B = Buffer.allocUnsafe(1 << 20);
    let compared = 0;
    while (compared < n) {
      const want = Math.min(A.length, n - compared);
      const a = readSync(fs, A, 0, want, null);
      const b = readSync(fm, B, 0, want, null);
      if (a !== b) return false;
      if (!A.subarray(0, a).equals(B.subarray(0, b))) return false;
      compared += a;
      if (a === 0) break;
    }
    return compared === n;
  } finally {
    closeSync(fs);
    closeSync(fm);
  }
}

const HELP = [
  '用法：node tools/trim-song.mjs <make|check> [选项]',
  '',
  '  make  --src <原曲> --out <母版> [--fps 24] [--patch-info]',
  '  check [--src input/song.mp3] [--master <母版>] [--resource Resource/song.json] [--src-required]',
  '',
  '退出码：0 通过 / 1 母版不匹配或结构不符 / 2 用法错误',
].join('\n');

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const args = [...argv];
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(HELP);
    return args.length === 0 ? 2 : 0;
  }
  let cmd = args.shift();
  // 允许省略子命令（与 Python 版一致：没有子命令时按 make 处理）
  if (cmd !== 'make' && cmd !== 'check') {
    if (cmd.startsWith('-')) {
      args.unshift(cmd);
      cmd = 'make';
    } else {
      console.error(`用法错误：未知子命令 "${cmd}"\n${HELP}`);
      return 2;
    }
  }

  /** @type {Record<string, any>} */
  const opt = {
    src: 'input/song.mp3',
    out: null,
    master: null,
    resource: 'Resource/song.json',
    // 默认值：JS 没有 int/float 之分，写 24 与 24.0 是同一个数。
    // Python 版默认 `24.0`，所以它的 JSON 里会出现 "fps": 24.0 —— 纯打印差异，不影响产物。
    fps: 24,
    patchInfo: false,
    srcRequired: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => {
      if (i + 1 >= args.length) throw new UsageError(`${a} 缺参数值`);
      return args[++i];
    };
    switch (a) {
      case '--src':
        opt.src = val();
        break;
      case '--out':
        opt.out = val();
        break;
      case '--master':
        opt.master = val();
        break;
      case '--resource':
        opt.resource = val();
        break;
      case '--fps':
        opt.fps = parseFps(val());
        break;
      case '--patch-info':
        opt.patchInfo = true;
        break;
      case '--src-required':
        opt.srcRequired = true;
        break;
      default:
        throw new UsageError(`未知参数 "${a}"`);
    }
  }

  if (cmd === 'make') {
    if (!opt.out) throw new UsageError('make 需要 --out <母版>');
    return cmdMake({ src: opt.src, out: opt.out, fps: opt.fps, patchInfo: opt.patchInfo });
  }
  return cmdCheck({
    src: opt.src,
    master: opt.master,
    resource: opt.resource,
    srcRequired: opt.srcRequired,
  });
}

// 只有直接跑这个文件时才执行 main（被 parity 脚本 import 时不执行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`用法错误：${e.message}`);
      process.exitCode = 2;
    } else {
      console.error(`错误：${/** @type {Error} */ (e).message}`);
      process.exitCode = 1;
    }
  }
}

export { main, UsageError };
