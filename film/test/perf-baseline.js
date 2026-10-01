#!/usr/bin/env node
/**
 * film/test/perf-baseline.js — Phase 2 性能基线（施工说明 §6 Phase 2 验收的最后一条）。
 *
 * 为什么现在测（施工说明 §8 风险 5）：`gaussianBlur` 是单帧最大开销。
 * 4741 帧 × 8 核，如果单次模糊是 100–200 ms，纯模糊就是 10–20 分钟。
 * 这个数字决定 Phase 4 要不要动「逃生舱」（把 `kit/raster.js` 内部换成 sharp）。
 *
 * 用法：
 *   node film/test/perf-baseline.js
 *   node film/test/perf-baseline.js --json      # 只输出 JSON（好贴进施工说明）
 *
 * 测法：每个用例先跑 2 次热身（JIT + 缓存），再测 N 次取**中位数**
 * （不用平均值：一次 GC 就能把平均值拉歪）。
 */

import { createCanvas } from '@napi-rs/canvas';

import { gaussianBlur, boxDownsample, readRaw, stddev } from '../kit/raster.js';

/**
 * 跑一个用例，返回中位耗时（ms）。
 * @param {string} name
 * @param {number} w @param {number} h
 * @param {() => any} fn
 * @param {{warmup?: number, iters?: number}} [opts]
 * @returns {{name: string, w: number, h: number, ms: number, iters: number, samples: number[]}}
 */
function bench(name, w, h, fn, opts = {}) {
  const warmup = opts.warmup ?? 2;
  const iters = opts.iters ?? 5;
  for (let i = 0; i < warmup; i++) fn();
  /** @type {number[]} */
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const ms = samples[Math.floor(samples.length / 2)];
  return { name, w, h, ms, iters, samples };
}

/**
 * 造一张有内容的图（纯色图会让某些实现被分支预测糊过去，测不准）。
 * @param {number} w @param {number} h
 */
function testImage(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#0b1220');
  g.addColorStop(0.5, '#1d4ed8');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e5e7eb';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 137) % w, (i * 91) % h, 60, 24);
  }
  ctx.font = '32px Consolas';
  ctx.fillText('perf baseline 0123456789', 40, h - 40);
  const raw = readRaw(cv);
  console.log(
    `  测试图  ${w}×${h}  stddev=${stddev(raw).toFixed(2)}` +
      `${stddev(raw) < 1 ? '  ⚠️ 太扁了，测不准' : ''}`,
  );
  return raw;
}

const JSON_ONLY = process.argv.includes('--json');

/** @type {ReturnType<typeof bench>[]} */
const results = [];
const sizes = [
  [1280, 720],
  [1920, 1080],
];

if (!JSON_ONLY) {
  console.log('── Phase 2 性能基线 ────────────────────────────────────────');
  console.log(`Node ${process.version} · ${process.platform} ${process.arch} · ${process.env.PROCESSOR_IDENTIFIER ?? ''}`);
  console.log(`逻辑核数 ${(await import('node:os')).availableParallelism()}`);
  console.log('');
}

for (const [w, h] of sizes) {
  if (!JSON_ONLY) console.log(`[${w}×${h}]`);
  const img = testImage(w, h);
  const blurred = gaussianBlur(img, 8); // 预热产物，给吞吐型用例当输入

  for (const sigma of [2, 8]) {
    const r = bench(`gaussianBlur(sigma=${sigma})`, w, h, () => gaussianBlur(img, sigma));
    results.push(r);
    if (!JSON_ONLY) console.log(`  ${r.name.padEnd(30)} ${r.ms.toFixed(1).padStart(8)} ms   (中位/${r.iters} 次)`);
  }

  // 三条性能逃生路线（施工说明 §8 风险 5）。
  // 现实里要用的是**第三条**：辉光本来就不需要全分辨率。
  {
    const r = bench('gaussianBlur(sigma=8, box)', w, h, () => gaussianBlur(img, 8, { box: true }));
    results.push(r);
    if (!JSON_ONLY) console.log(`  ${r.name.padEnd(30)} ${r.ms.toFixed(1).padStart(8)} ms   (滑动窗口近似, O(1)/像素)`);
  }
  {
    const r = bench('sigma=8, radius=2.5σ', w, h, () => gaussianBlur(img, 8, { radius: Math.ceil(8 * 2.5) }));
    results.push(r);
    if (!JSON_ONLY) console.log(`  ${r.name.padEnd(30)} ${r.ms.toFixed(1).padStart(8)} ms   (砍高斯尾部)`);
  }
  for (const div of [2, 4]) {
    const r = bench(`bloom@1/${div} (降采样→模糊→放大)`, w, h, () => {
      const small = boxDownsample(img, Math.floor(w / div), Math.floor(h / div));
      const blur = gaussianBlur(small, 8 / div);
      return boxDownsample(blur, w, h);
    });
    results.push(r);
    if (!JSON_ONLY) console.log(`  ${r.name.padEnd(30)} ${r.ms.toFixed(1).padStart(8)} ms   ← 辉光该走这条`);
  }

  const rBox = bench('boxDownsample', w, h, () => boxDownsample(img, Math.floor(w / 8), Math.floor(h / 8)));
  results.push(rBox);
  if (!JSON_ONLY) {
    console.log(`  ${rBox.name.padEnd(26)} ${rBox.ms.toFixed(1).padStart(8)} ms   → ${Math.floor(w / 8)}×${Math.floor(h / 8)}`);
  }

  const rBlit = bench('encodePng(相当于出图)', w, h, () => {
    const cv = createCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.putImageData(ctx.createImageData(1, 1), 0, 0);
    return cv.toBuffer('image/png');
  });
  results.push(rBlit);
  if (!JSON_ONLY) console.log(`  ${rBlit.name.padEnd(26)} ${rBlit.ms.toFixed(1).padStart(8)} ms`);

  const rStats = bench('stddev 扫描', w, h, () => stddev(blurred));
  results.push(rStats);
  if (!JSON_ONLY) console.log(`  ${rStats.name.padEnd(26)} ${rStats.ms.toFixed(1).padStart(8)} ms`);

  if (!JSON_ONLY) console.log('');
}

// 单帧预算推算：假设 1 次 sigma=8 模糊 + 1 次 boxDownsample + 1 次 stddev
const perFrame = sizes.map(([w, h]) => {
  const pick = (n) => results.find((r) => r.name === n && r.w === w && r.h === h)?.ms ?? 0;
  const total = pick('gaussianBlur(sigma=8)') + pick('boxDownsample') + pick('stddev 扫描');
  return { w, h, ms: total };
});

if (JSON_ONLY) {
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        cores: (await import('node:os')).availableParallelism(),
        results: results.map((r) => ({ name: r.name, w: r.w, h: r.h, ms: Number(r.ms.toFixed(2)) })),
        perFrameApprox: perFrame.map((p) => ({ size: `${p.w}x${p.h}`, ms: Number(p.ms.toFixed(2)) })),
      },
      null,
      2,
    ),
  );
} else {
  console.log('── 推算（一次 sigma=8 模糊 + 一次 box 降采样 + 一次 stddev 扫描）──');
  for (const p of perFrame) {
    const fps8 = 8 / (p.ms / 1000);
    console.log(
      `  ${p.w}×${p.h}   单帧 ≈ ${p.ms.toFixed(1)} ms   ` +
        `→ 8 核并行整片 4741 帧 ≈ ${((p.ms * 4741) / 8 / 1000 / 60).toFixed(1)} 分钟（不含绘制与编码）`,
    );
    void fps8;
  }
  console.log('');
  console.log('判据（施工说明 §8 风险 5）：单帧预算 1000/24 ≈ 41.7 ms。');
  console.log('  若上面单帧推算已接近或超过 41.7 ms，Phase 4 之前先考虑 sharp 逃生舱。');
}
