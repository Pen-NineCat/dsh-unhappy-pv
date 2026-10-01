/**
 * film/test/render-guards.test.js — ⭐ 同帧双渲比对 + 帧哈希幂等（施工说明 §6 Phase 0）。
 *
 * 验收要求：
 *   - `frameHash()` 对同一张图两次调用结果相同
 *   - 同一张合成图渲两次，差异的 bbox 为 `null`
 *
 * Phase 0 刻意只画「一个方块 + 几个字 + 一个圆」这种最小合成，**不写任何场景代码**；
 * 目的是证明「Canvas2D 的同一串 draw call 在进程内是确定性的」这条前提成立。
 * 真正的场景在 `film/content/`，从 Phase 3 起。
 *
 * 注意：这里只证明**同机、同进程内**可重复。跨机器一致性没有验证
 * （`AGENTS.md` §8 末句；施工说明 §7.3）。
 */

import { W, H } from '../engine/clock.js';
import { frameHash, formatManifest, readManifest, compareManifests, writeManifest } from '../hash.js';
import { assertSame, diffRGBA, rawRGB, rawRGBA } from '../kit/pixels.js';
import { contains, describe, eq, ok, require_, test, throws } from './_harness.js';

const { createCanvas } = require_('@napi-rs/canvas');

/**
 * 一张最小但**非平凡**的合成图：底色 + 渐变方块 + 圆 + 文字。
 * 用固定参数、不用随机（`AGENTS.md` §2 规则 7）。
 * @param {number} seedPhase 0..1，控制方块位置（用来产出一张「不同的图」）
 * @returns {import('@napi-rs/canvas').Canvas}
 */
function renderSample(seedPhase = 0) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d4ed8');
  g.addColorStop(1, '#0f766e');
  ctx.fillStyle = g;
  const x = Math.round(100 + seedPhase * 800);
  ctx.fillRect(x, 200, 480, 270);

  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '48px Consolas';
  ctx.fillStyle = '#e5e7eb';
  ctx.fillText(`frame sample ${seedPhase}`, 200, 800);
  return cv;
}

describe('像素边界 · RGB 与 RGBA', () => {
  test('rawRGB 长度 = W*H*3，rawRGBA 长度 = W*H*4', () => {
    const cv = renderSample();
    eq(rawRGB(cv).length, W * H * 3, 'rgb24 字节数');
    eq(rawRGBA(cv).data.length, W * H * 4, 'rgba 字节数');
  });

  test('不透明图的 RGB 与 RGBA 前三通道一致（alpha=255 时不该有损失）', () => {
    const cv = renderSample();
    const rgb = rawRGB(cv);
    const rgba = rawRGBA(cv);
    for (const i of [0, 4, 12345, W * H - 1]) {
      eq(rgb[i * 3], rgba.data[i * 4], `像素 ${i} 的 R`);
      eq(rgb[i * 3 + 1], rgba.data[i * 4 + 1], `像素 ${i} 的 G`);
      eq(rgb[i * 3 + 2], rgba.data[i * 4 + 2], `像素 ${i} 的 B`);
    }
  });
});

describe('⭐ 同帧双渲比对', () => {
  test('同一串 draw call 渲两次：diff 为空、bbox 为 null', () => {
    const a = rawRGBA(renderSample());
    const b = rawRGBA(renderSample());
    const d = diffRGBA(a, b);
    ok(d.equal, `两次渲染应当逐像素一致，但有 ${d.pixels} 个像素不同`);
    eq(d.bbox, null, 'bbox');
    assertSame(a, b, 'sample frame');
  });

  test('不同的图必须报出差异区域坐标与首个差异像素（不是一句 differs）', () => {
    const a = rawRGBA(renderSample(0));
    const b = rawRGBA(renderSample(0.5));
    const d = diffRGBA(a, b);
    ok(!d.equal, '两张不同的图不该相等');
    ok(d.bbox !== null, '要给出差异 bbox');
    ok(d.pixels > 0 && d.maxDelta > 0, '要给出差异像素数与最大通道差');

    const err = throws(() => assertSame(a, b, 'frame 2769'), '两张不同的图');
    contains(err.message, 'frame 2769', '要带上是哪一帧');
    contains(err.message, 'bbox (x0=', '要带差异区域坐标');
    contains(err.message, '首个差异像素 (', '要带首个差异像素');
    contains(err.message, '个像素不同', '要报差异规模');
  });

  test('尺寸不同的两张图直接报错（不能拿错的图去比）', () => {
    const a = rawRGBA(renderSample());
    const small = createCanvas(64, 64);
    const b = rawRGBA(small);
    const err = throws(() => diffRGBA(a, b), '尺寸不一致');
    contains(err.message, '尺寸不一致', '要说清是尺寸问题');
  });
});

describe('⭐ 帧哈希', () => {
  test('frameHash 对同一张图两次调用结果相同', () => {
    const cv = renderSample();
    eq(frameHash(cv), frameHash(cv), '同一张图两次哈希');
  });

  test('重渲一遍的同一帧哈希相同（这才是护栏要的）', () => {
    eq(frameHash(renderSample(0.25)), frameHash(renderSample(0.25)), '重渲同帧的哈希');
  });

  test('不同内容的帧哈希不同', () => {
    ok(frameHash(renderSample(0)) !== frameHash(renderSample(0.5)), '不同内容哈希应当不同');
  });

  test('哈希是 64 位小写十六进制', () => {
    ok(/^[0-9a-f]{64}$/.test(frameHash(renderSample())), '格式');
  });
});

describe('帧哈希清单', () => {
  test('格式化 → 解析 往返一致', () => {
    const cv = renderSample();
    const h = frameHash(cv);
    const entries = [
      { n: 2, sha256: h },
      { n: 0, sha256: h },
      { n: 1, sha256: h },
    ];
    const text = formatManifest(entries);
    const lines = text.trim().split('\n');
    eq(lines.length, 3, '行数');
    eq(lines[0], `0\t${h}`, '排序后的第一行');
    ok(text.endsWith('\n'), '末尾要有换行（否则 diff 会报 \\ No newline）');
  });

  test('写盘 → 读回 一致，且能比较出差异帧号', () => {
    const cv = renderSample();
    const h = frameHash(cv);
    const path = 'out/_test_frames.sha256';
    writeManifest(
      [
        { n: 0, sha256: h },
        { n: 1, sha256: h },
      ],
      path,
    );
    const back = readManifest(path);
    eq(back.length, 2, '读回的帧数');
    ok(compareManifests(back, back).same, '自己跟自己比应当相同');

    const other = [
      { n: 0, sha256: h },
      { n: 1, sha256: 'f'.repeat(64) },
      { n: 2, sha256: h },
    ];
    const cmp = compareManifests(back, other);
    ok(!cmp.same, '应当不同');
    eq(cmp.differing.join(','), '1', '差异帧号');
    eq(cmp.onlyB.join(','), '2', '只在 B 里的帧号');
    eq(cmp.count, 2, '差异总数');
  });

  test('格式坏掉的清单要抛错并带行号', () => {
    const path = 'out/_test_bad_manifest.sha256';
    writeManifest([{ n: 0, sha256: frameHash(renderSample()) }], path);
    const { writeFileSync } = require_('node:fs');
    writeFileSync(path, '0\tnot-a-hash\n', 'utf8');
    const err = throws(() => readManifest(path), '坏的清单');
    contains(err.message, ':1', '要带行号');
    contains(err.message, 'n<TAB>sha256', '要给出期望格式');
  });
});
