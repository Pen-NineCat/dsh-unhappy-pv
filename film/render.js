#!/usr/bin/env node
/**
 * film/render.js — 单帧渲染 CLI（Phase 3）。
 *
 * 用途（`AGENTS.md` §5：**只重渲某几帧**这个开关务必保留）：
 *
 *   node film/render.js --frames 2769,2770,2800      # 出 PNG 抽查
 *   node film/render.js --range 100 200
 *   node film/render.js --frames 100,100 --diff      # ⭐ 同帧双渲比对
 *
 * `--diff` 是施工说明附录 B 里的护栏命令：**同一帧渲两次并逐像素比对**，
 * 不一致时打印差异区域坐标与首个差异像素（不是一句 differs）。
 *
 * 输出目录默认 out/stills/（.gitignore 已忽略 out/ 与 stills 前缀的目录）。
 *
 * 退出码：0 通过 / 1 渲染或比对失败 / 2 用法错误。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FRAME_COUNT, describe as describeClock } from './engine/clock.js';
import { frame } from './engine/frame.js';
import { encodePng } from './kit/canvas.js';
import { assertSame, diffRGBA, rawRGBA } from './kit/pixels.js';
import { DEFAULTS, describeConfig, envOverrides, mergeConfig, parseOverrides } from './kit/post-config.js';
import { frameHash } from './hash.js';

const HELP = [
  '用法：node film/render.js [选项]',
  '',
  '  --frames 1,2,3      渲这几帧（逗号分隔）',
  '  --range A B         渲 [A, B] 闭区间',
  '  --diff              同一帧渲两次并逐像素比对（⭐ 护栏）',
  '  --out <dir>         输出目录，默认 out/stills',
  '  --no-png            只判一致性/哈希，不落盘',
  '  --post k=v,k=v      覆盖后期参数（trailAmount/bloomAmount/scanlineAmount/vignetteStrength/…）',
  '  --no-post           关掉后期四件套（排障用：只看六层合成）',
  '  -h, --help          这段文字',
  '',
  `画布：${describeClock()}`,
  `后期默认：${describeConfig(DEFAULTS)}`,
  '退出码：0 通过 / 1 失败 / 2 用法错误',
].join('\n');

/** 用法错误（退出码 2）。 */
class UsageError extends Error {}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{frames: number[], diff: boolean, out: string, png: boolean, post: string[], noPost: boolean}} */
  const o = { frames: [0], diff: false, out: 'out/stills', png: true, post: [], noPost: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--frames': {
        const v = argv[++i];
        if (v === undefined) throw new UsageError('--frames 缺参数值');
        o.frames = v.split(',').map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n)) throw new UsageError(`--frames 里 "${s}" 不是整数帧号`);
          return n;
        });
        break;
      }
      case '--range': {
        const a0 = Number(argv[++i]);
        const b0 = Number(argv[++i]);
        if (!Number.isInteger(a0) || !Number.isInteger(b0)) throw new UsageError('--range A B 都要是整数');
        if (b0 < a0) throw new UsageError(`--range 的 B(${b0}) 小于 A(${a0})`);
        o.frames = [];
        for (let n = a0; n <= b0; n++) o.frames.push(n);
        break;
      }
      case '--diff':
        o.diff = true;
        break;
      case '--out':
        o.out = argv[++i] ?? 'out/stills';
        break;
      case '--no-png':
        o.png = false;
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
  return o;
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }

  console.log(`画布 ${describeClock()}`);
  console.log(`帧数 ${o.frames.length}${o.diff ? '（--diff：每帧渲两次）' : ''}`);

  // 后期参数：默认 → 环境变量 → CLI（优先级从低到高，见 kit/post-config.js）
  let postCfg;
  try {
    postCfg = mergeConfig(envOverrides(), parseOverrides(o.post));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }
  const postEnable = o.noPost
    ? { trail: false, bloom: false, scanlines: false, vignette: false }
    : undefined;
  console.log(`后期 ${o.noPost ? '（--no-post：全关）' : describeConfig(postCfg)}`);

  if (o.png) mkdirSync(o.out, { recursive: true });

  let failures = 0;
  for (const n of o.frames) {
    if (n < 0 || n >= FRAME_COUNT) {
      console.error(`  ❌ 帧 ${n} 越界（有效范围 0..${FRAME_COUNT - 1}）`);
      failures++;
      continue;
    }
    try {
      const cv = frame(n, null, { post: postCfg, postEnable });
      const hash = frameHash(cv);
      let line = `  ${String(n).padStart(5)}  ${hash.slice(0, 16)}…`;

      if (o.diff) {
        // ⭐ 同帧双渲：**同一帧渲两次**（不是「渲两帧」）
        const a = rawRGBA(cv);
        const b = rawRGBA(frame(n, null, { post: postCfg, postEnable }));
        const d = diffRGBA(a, b);
        assertSame(a, b, `frame ${n}`);
        line += `  ⭐ 双渲一致 (bbox=${d.bbox === null ? 'null' : JSON.stringify(d.bbox)})`;
      }

      if (o.png) {
        const path = join(o.out, `${String(n).padStart(5, '0')}.png`);
        const buf = encodePng(cv);
        writeFileSync(path, buf);
        line += `  → ${path}`;
      }
      console.log(`  ✅${line}`);
    } catch (e) {
      failures++;
      console.error(`  ❌ 帧 ${n} 失败：`);
      console.error(
        /** @type {Error} */ (e)
          .message.split('\n')
          .map((l) => `       ${l}`)
          .join('\n'),
      );
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`结论：${o.frames.length} 帧全部渲染成功${o.diff ? '，且双渲逐像素一致' : ''}。`);
    return 0;
  }
  console.log(`结论：${failures} 帧失败。`);
  return 1;
}

process.exitCode = main();
