#!/usr/bin/env node
/**
 * film/render-video.js — 分段渲染 + ffmpeg 编码 + concat + 混音（Phase 3）。
 *
 * 结构（施工说明 §5.4，每一条都是硬约束）
 * ------------------------------------
 * - **`worker_threads`**，`N = max(1, availableParallelism() - 2)`（施工说明 §6 Phase 3 第 1 条）
 * - **按连续帧段切分**，worker `k` 负责 `[n0_k, n1_k)`，段内 `prev` 从 `null` 起。
 *   **不要交错分配帧**（施工说明 §5.4 第 2 条）
 * - 每个 worker 起**自己的** ffmpeg，把 raw `rgb24` 直接 pipe 进 stdin
 * - **喂管道前断言** `W×H`、`rgb24`、buffer 长度 `W*H*3` —— 这是「花屏」类事故的唯一原因
 * - **concat 不重编码**（`-c:v copy`）
 * - **片长由帧数决定，不由音频决定**：用 `-frames:v <总帧数>`。
 *   ❌ **绝不用 `-shortest`** —— 实测会把 4741 帧切成 4739 帧（`AGENTS.md` §3）
 * - **混音用母版** `input/song.master.mp3`，不用原曲
 * - ffmpeg 路径走三级解析（`film/lib/ffmpeg-path.js`）
 *
 * 用法：
 *   node film/render-video.js                       # 全片
 *   node film/render-video.js --range 100 200       # 只渲 [100, 200]
 *   node film/render-video.js --frames 2769,2770,2800
 *   node film/render-video.js --workers 8 --keep-segments
 *   node film/render-video.js --out out/film.mp4 --audio input/song.master.mp3
 *   node film/render-video.js --no-audio            # 只出画面（给护栏数帧数用）
 *
 * 退出码：0 成功 / 1 失败 / 2 用法错误。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { Worker } from 'node:worker_threads';

import { END_T, FPS, FRAME_COUNT, H, W } from './engine/clock.js';
import { frame } from './engine/frame.js';
import { describeConfig, envOverrides, mergeConfig, parseOverrides } from './kit/post-config.js';
import { resolveFfmpegTools } from './lib/ffmpeg-path.js';
import { assertSegmentSum, contiguousRuns, segmentRuns } from './lib/frame-segments.js';

const HELP = [
  '用法：node film/render-video.js [选项]',
  '',
  '  --range A B         只渲闭区间 [A, B]',
  '  --frames 1,2,3      只渲这几帧',
  '  --workers N         并行 worker 数，默认 max(1, availableParallelism()-2)',
  '  --out <path>        成片路径，默认 out/film.mp4',
  '  --audio <path>      混音用的音频，默认 input/song.master.mp3（母版！）',
  '  --no-audio          不混音（给「成片帧数」护栏用）',
  '  --crf N             x264 质量，默认 16',
  '  --preset <name>     x264 preset，默认 slow',
  '  --codec <名字>       x264（默认，yuv420p 交付向）| lossless（libx264rgb -qp 0，逐字节无损）',
  '  --deliver [path]    再转一份**交付片**：yuv420p + BT.709 标记 + faststart，默认 out/film.deliver.mp4',
  '  --keep-segments     保留 segments/ 与 concat 清单（排障用）',
  '  --manifest [path]   把**喂进 ffmpeg 的帧**哈希写成清单，默认 out/frames.sha256',
  '                      这是「worker 数无关」该量的东西：mp4 的字节不是（x264 依赖 GOP 位置）',
  '  --post k=v,k=v      覆盖后期参数（trailAmount/bloomAmount/scanlineAmount/vignetteStrength/…）',
  '  --no-post           关掉后期四件套（排障用：只看六层合成）',
  '  -h, --help          这段文字',
  '',
  '退出码：0 成功 / 1 失败 / 2 用法错误',
].join('\n');

/** 用法错误。 */
class UsageError extends Error {}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const o = {
    n0: 0,
    /** 结束帧号，**含**（CLI 侧用闭区间，好写「渲帧 0 到 23 这 24 帧」） */
    n1Incl: FRAME_COUNT - 1,
    workers: Math.max(1, availableParallelism() - 2),
    out: 'out/film.mp4',
    audio: 'input/song.master.mp3',
    noAudio: false,
    crf: 16,
    preset: 'slow',
    codec: 'x264',
    deliver: /** @type {?string} */ (null),
    keep: false,
    frames: /** @type {?number[]} */ (null),
    manifest: /** @type {?string} */ (null),
    post: /** @type {string[]} */ ([]),
    noPost: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--range': {
        const x = Number(argv[++i]);
        const y = Number(argv[++i]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) throw new UsageError('--range A B 都要是整数');
        if (y < x) throw new UsageError(`--range 的 B(${y}) 小于 A(${x})`);
        o.n0 = x;
        o.n1Incl = y;
        o.frames = null;
        break;
      }
      case '--frames': {
        const v = argv[++i];
        if (v === undefined) throw new UsageError('--frames 缺参数值');
        const list = v.split(',').map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n)) throw new UsageError(`--frames 里 "${s}" 不是整数帧号`);
          return n;
        });
        // 非连续帧走单帧路径（分段渲染要求每段连续）
        o.frames = [...new Set(list)].sort((p, q) => p - q);
        o.n0 = o.frames[0];
        o.n1Incl = o.frames[o.frames.length - 1];
        break;
      }
      case '--workers': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--workers 必须是 >= 1 的整数');
        o.workers = n;
        break;
      }
      case '--out':
        o.out = argv[++i] ?? o.out;
        break;
      case '--audio':
        o.audio = argv[++i] ?? o.audio;
        break;
      case '--no-audio':
        o.noAudio = true;
        break;
      case '--crf': {
        o.crf = Number(argv[++i]);
        if (!Number.isFinite(o.crf)) throw new UsageError('--crf 要是数字');
        break;
      }
      case '--preset':
        o.preset = argv[++i] ?? o.preset;
        break;
      case '--codec': {
        const v = argv[++i];
        if (v !== 'x264' && v !== 'lossless') {
          throw new UsageError(`--codec 只支持 x264 / lossless，收到 "${v}"`);
        }
        o.codec = v;
        break;
      }
      case '--deliver': {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          o.deliver = next;
          i++;
        } else {
          o.deliver = 'out/film.deliver.mp4';
        }
        break;
      }
      case '--keep-segments':
        o.keep = true;
        break;
      case '--manifest':
        o.manifest = argv[++i] ?? 'out/frames.sha256';
        break;
      case '--post':
        o.post.push(argv[++i] ?? '');
        break;
      case '--no-post':
        o.noPost = true;
        break;
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new UsageError(`未知参数 "${a}"`);
    }
  }
  if (o.n0 < 0 || o.n1Incl >= FRAME_COUNT) {
    throw new UsageError(`帧号越界：有效范围 0..${FRAME_COUNT - 1}，收到 [${o.n0}, ${o.n1Incl}]`);
  }
  return o;
}

/**
 * 把帧号列表切成 **连续段**（施工说明 §5.4 第 2 条：绝不交错分配）。
 *
 * 切分逻辑在 `lib/frame-segments.js` 里，**渲染侧与测试共用一份** ——
 * 这样「worker 数无关」那条验收测的就是真正在跑的那段代码。
 */

/**
 * 跑一条 ffmpeg 命令，失败就把 stderr 尾部打出来。
 * @param {string} bin @param {string[]} args @param {string} what
 */
function runFfmpeg(bin, args, what) {
  const r = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (r.status !== 0 || r.error) {
    const tail = `${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`${what} 失败（退出码 ${r.status ?? 'spawn-error'}）：\n${tail}`);
  }
  return r;
}

/**
 * 分段渲染：每个 worker 渲一段连续帧、自己 pipe 给一个 ffmpeg 段文件。
 * @param {Array<[number, number]>} segs
 * @param {{ffmpeg: string, crf: number, preset: string, codec: string, dir: string, manifest: boolean}} opt
 * @returns {Promise<{paths: string[], feedHashes: string[]}>} 段文件（按帧序）+ 喂进管道的帧哈希
 */
async function renderSegments(segs, opt) {
  const workerUrl = new URL('./lib/render-worker.js', import.meta.url);
  /** @type {Promise<{index: number, path: string, feedHashes: string[]}>[]} */
  const jobs = segs.map(
    ([n0, n1], index) =>
      new Promise((res, rej) => {
        const path = join(opt.dir, `seg-${String(index).padStart(4, '0')}.mp4`);
        const w = new Worker(workerUrl, {
          workerData: {
            n0,
            n1,
            path,
            ffmpeg: opt.ffmpeg,
            crf: opt.crf,
            preset: opt.preset,
            fps: FPS,
            w: W,
            h: H,
            manifest: opt.manifest,
            codec: opt.codec,
            post: opt.post,
            postEnable: opt.postEnable,
          },
        });
        /** @type {string[]} */
        const feed = [];
        w.on('message', (/** @type {any} */ m) => {
          if (m?.type === 'progress') {
            process.stdout.write(`\r  worker ${index}: ${m.done}/${m.total} 帧`);
          } else if (m?.type === 'done' && Array.isArray(m.feedHashes)) {
            feed.push(...m.feedHashes);
          } else if (m?.type === 'error') {
            process.stdout.write('\n');
            console.error(`  worker ${index}（帧 ${n0}..${n1 - 1}）报错：${m.message}`);
          }
        });
        w.on('error', rej);
        w.on('exit', (code) => {
          if (code === 0) res({ index, path, feedHashes: feed });
          else rej(new Error(`worker ${index}（帧 ${n0}..${n1 - 1}）退出码 ${code}`));
        });
      }),
  );
  const done = await Promise.all(jobs);
  process.stdout.write('\n');
  const sorted = done.sort((a, b) => a.index - b.index);
  /** @type {string[]} */
  const feedHashes = [];
  for (const d of sorted) feedHashes.push(...d.feedHashes);
  return { paths: sorted.map((d) => d.path), feedHashes };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }
  const { ffmpeg: ff, ffprobe: fp } = resolveFfmpegTools();
  console.log(`画布   ${W}×${H} @ ${FPS} fps · t ∈ [0, ${END_T}] · 期望 ${FRAME_COUNT} 帧`);
  console.log(`ffmpeg ${ff.path}  (${ff.via})`);
  console.log(`ffprobe ${fp.path}  (${fp.via})`);
  if (ff.via === 'unresolved' || !ff.exists) {
    console.error('找不到可用的 ffmpeg —— 设 $env:FFMPEG 或把 ffmpeg 放进 PATH');
    return 1;
  }

  /** @type {(n: number) => boolean} */
  const inRange = o.frames ? (n) => o.frames.includes(n) : () => true;
  // CLI 侧是闭区间 [n0, n1Incl]；切分函数用左闭右开 [n0, n1Excl)
  const n1Excl = o.n1Incl + 1;
  const runs = contiguousRuns(inRange, o.n0, n1Excl - 1);
  const totalFrames = o.frames ? o.frames.length : n1Excl - o.n0;
  if (totalFrames === 0) {
    console.error('没有要渲染的帧');
    return 2;
  }

  // 非连续帧 → 单帧 PNG 路径（分段渲染要求每段连续，硬凑会破坏「段内 prev 连续」的语义）
  if (runs.length > 1) {
    console.log(`\n帧列表不连续（${runs.length} 段），走**单帧 PNG** 路径，不出 mp4。`);
    console.log('  理由：worker 必须渲**连续帧段**，交错分配会破坏段内 prev 的连续性（施工说明 §5.4 第 2 条）。');
    const { frameHash } = await import('./hash.js');
    const { encodePng } = await import('./kit/canvas.js');
    const outDir = 'out/stills';
    mkdirSync(outDir, { recursive: true });
    for (const n of o.frames ?? []) {
      const cv = frame(n);
      const p = join(outDir, `${String(n).padStart(5, '0')}.png`);
      writeFileSync(p, encodePng(cv));
      console.log(`  ${String(n).padStart(5)}  ${frameHash(cv).slice(0, 16)}…  → ${p}`);
    }
    console.log(`\n结论：${o.frames?.length ?? 0} 帧已出 PNG。`);
    return 0;
  }

  const dir = 'segments';
  mkdirSync(dir, { recursive: true });
  const nTasks = Math.max(1, Math.min(o.workers, totalFrames));
  const [start, endExcl] = runs[0];
  const segs = segmentRuns(start, endExcl, nTasks);

  console.log(`\n[1/4] 分段渲染 ${totalFrames} 帧 → ${segs.length} 段（连续帧段，段内 prev=null 起跑）`);
  console.log(`      ${segs.map(([a, b]) => `${a}..${b - 1}`).join(' | ')}`);
  const t0 = Date.now();
  const rendered = await renderSegments(segs, {
    ffmpeg: ff.path,
    crf: o.crf,
    preset: o.preset,
    codec: o.codec,
    dir,
    manifest: o.manifest,
  });
  const segPaths = rendered.paths;
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`      完成，用时 ${dt} s（${(totalFrames / Number(dt)).toFixed(1)} 帧/s）`);

  if (o.manifest) {
    // 喂进管道的帧哈希：这才是「worker 数无关」该量的东西（见 --manifest 的帮助）
    const text = `${rendered.feedHashes.join('\n')}\n`;
    writeFileSync(o.manifest, text, 'utf8');
    console.log(`      帧哈希清单 → ${o.manifest}（${rendered.feedHashes.length} 行）`);
  }

  // ⭐ 帧数对账（护栏之一）：各段区间求和必须等于期望帧数
  assertSegmentSum(segs, totalFrames);

  mkdirSync('out', { recursive: true });
  const outPath = resolvePath(o.out);

  try {
    console.log('\n[2/4] concat（**不重编码**）');
    const listPath = join(dir, 'list.txt');
    // concat 清单里的路径要写成转义过的绝对路径，避免 ffmpeg 按清单所在目录解析
    writeFileSync(
      listPath,
      segPaths.map((p) => `file '${resolvePath(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n',
      'utf8',
    );
    const joined = join(dir, 'joined.mp4');
    runFfmpeg(ff.path, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', joined], 'concat');

    console.log('[3/4] 定长 + 混音');
    if (o.noAudio) {
      // 只出画面：仍然显式定长，不用 -shortest
      runFfmpeg(
        ff.path,
        ['-v', 'error', '-y', '-i', joined, '-frames:v', String(totalFrames), '-c', 'copy', '-movflags', '+faststart', outPath],
        '定长出片',
      );
    } else {
      if (!readable(o.audio)) {
        throw new Error(
          `找不到混音用的音频 ${o.audio}\n` +
            `  混音**必须用母版**（input/song.master.mp3），不要用原曲 —— 尾部那 0.632 帧会让末尾差一帧`,
        );
      }
      runFfmpeg(
        ff.path,
        [
          '-v', 'error', '-y',
          '-i', joined,
          '-i', o.audio,
          // 片长由帧数决定：-frames:v 是硬上限。
          // ❌ 绝不能用 -shortest：它按 ffprobe 报的 197.504 s 切，4741 帧会变成 4739 帧。
          '-frames:v', String(totalFrames),
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '192k',
          '-movflags', '+faststart',
          outPath,
        ],
        '混音出片',
      );
    }

    console.log('[4/4] 成片帧数护栏（ffprobe -count_frames）');
    const r = spawnSync(
      fp.path,
      ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', outPath],
      { encoding: 'utf8', windowsHide: true },
    );
    const got = Number(`${r.stdout ?? ''}`.trim());
    if (got !== totalFrames) {
      throw new Error(
        `⭐ 成片帧数不对：ffprobe 数出 ${got}，期望 ${totalFrames}\n` +
          `  hint: 别用 -shortest（实测会把 4741 帧切成 4739 帧，见 AGENTS.md §3）`,
      );
    }
    console.log(`      ✅ ffprobe 数出 ${got} 帧 == 期望 ${totalFrames}`);

    // ── 交付转码（可选）──────────────────────────────────────
    // 无损母版（libx264rgb）是**非标准**的 H.264：普通播放器解不对颜色，
    // 所以母版与交付片必须是两个文件（施工说明 §6 Phase 7 第 2/3 条）。
    if (o.deliver) {
      console.log('\n[5/5] 交付转码（yuv420p + BT.709 标记 + faststart）');
      const deliverArgs = [
        '-v', 'error', '-y',
        // ⚠️ BT.709 三个标记必须放在 `-i` **之前**（输入侧选项）。
        // 放在输出侧时实测只有 `colorspace` 生效，`color_primaries` / `color_transfer`
        // 仍然是 unknown（2026-10-01 实测 A/B/C 三组对照，见附录 C 记录 17）。
        // 不加的话有些播放器按 BT.601 解，颜色会偏。
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-i', outPath,
        '-c:v', 'libx264', '-crf', String(o.crf), '-preset', String(o.preset),
        '-pix_fmt', 'yuv420p',
        '-frames:v', String(totalFrames),
      ];
      if (!o.noAudio) deliverArgs.push('-c:a', 'aac', '-b:a', '192k');
      else deliverArgs.push('-an');
      deliverArgs.push('-movflags', '+faststart', o.deliver);
      runFfmpeg(ff.path, deliverArgs, '交付转码');
      const size = (await import('node:fs')).statSync(o.deliver).size;
      console.log(`      → ${o.deliver}  ${(size / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log(`\n结论：${outPath}${o.codec === 'lossless' ? '（**逐字节无损**母版）' : ''}`);
    return 0;
  } finally {
    if (!o.keep) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 删不掉就算了，segments/ 本来就被 .gitignore 忽略 */
      }
    } else {
      console.log(`（--keep-segments：${dir}/ 保留）`);
    }
  }
}

/** @param {string} p */
function readable(p) {
  try {
    readFileSync(p, { flag: 'r' });
    return true;
  } catch {
    return false;
  }
}

process.exitCode = await main().catch((e) => {
  console.error(`\n❌ 渲染失败：${/** @type {Error} */ (e).message}`);
  return 1;
});
