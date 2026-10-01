/**
 * film/lib/frame-segments.js — 帧段切分（**渲染侧与测试共用一份**，别写两遍）。
 *
 * 施工说明 §5.4 第 2 条：并行按**连续帧段**切分，worker `k` 负责 `[n0_k, n1_k)`，
 * **不要交错分配帧** —— 段内必须连续，否则 `prev` 的语义就没了。
 *
 * 「worker 数从 1 改到 8，产出的帧哈希清单完全相同」这条验收就是冲着这里的：
 * 切法变了，但每一帧的结果不能变。所以切分逻辑必须是**纯函数**，测试才能直接复用。
 */

/**
 * 把 `[start, endExcl)` 切成最多 `k` 个**连续**子段。
 *
 * ⚠️ 参数是**左闭右开**的帧号区间：`segmentRuns(0, 24, 4)` 切的是帧 `0..23` 这 24 帧。
 * CLI 的 `--range A B` 是**闭区间**（含 B），换算在这里的调用点上做一次
 * （见 `render-video.js`）—— 别在两个地方各留一种约定。
 *
 * - 段间首尾相接（无缝无叠）：`out[i][1] === out[i+1][0]`
 * - 合起来正好覆盖 `[start, endExcl)`
 * - 帧数少于 `k` 时**不会**产生空段
 * @param {number} start 起始帧号（含）
 * @param {number} endExcl 结束帧号（**不含**）
 * @param {number} k 想要的段数（最终可能更少）
 * @returns {Array<[number, number]>} 每段 `[a, b)`（左闭右开）
 */
export function segmentRuns(start, endExcl, k) {
  const total = endExcl - start;
  if (!Number.isInteger(start) || !Number.isInteger(endExcl) || total <= 0) {
    throw new Error(`segmentRuns: 区间非法 [${start}, ${endExcl})`);
  }
  const parts = Math.max(1, Math.min(Math.floor(k), total));
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < parts; i++) {
    const a = start + Math.floor((total * i) / parts);
    const b = start + Math.floor((total * (i + 1)) / parts);
    if (b > a) out.push([a, b]);
  }
  return out;
}

/**
 * 遍历一个段里的每个帧号（左闭右开）。
 * 生成器而不是数组：整片 4741 帧造个数组没必要。
 * @param {number} a 含
 * @param {number} b 不含
 * @returns {Generator<number>}
 */
export function* eachFrameOfSegment(a, b) {
  for (let n = a; n < b; n++) yield n;
}

/**
 * 把一个（可能不连续的）帧号集合压成**连续段**。
 *
 * 用法：`--frames 2769,2770,2800` 这种输入会得到 `[[2769,2771],[2800,2801]]` ——
 * 两段之间不连续，所以调用方应当走单帧路径，而不是硬凑成一段
 * （硬凑会让段的 `prev` 语义错掉）。
 * @param {(n: number) => boolean} inRange
 * @param {number} n0 含
 * @param {number} n1 含
 * @returns {Array<[number, number]>} 左闭右开
 */
export function contiguousRuns(inRange, n0, n1) {
  /** @type {Array<[number, number]>} */
  const runs = [];
  let start = -1;
  for (let n = n0; n <= n1; n++) {
    if (inRange(n)) {
      if (start < 0) start = n;
    } else if (start >= 0) {
      runs.push([start, n]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, n1 + 1]);
  return runs;
}

/**
 * ⭐ 帧数对账：各段求和 == 期望帧数。
 * @param {Array<[number, number]>} segs
 * @param {number} expected
 * @throws {Error}
 */
export function assertSegmentSum(segs, expected) {
  const sum = segs.reduce((a, [x, y]) => a + (y - x), 0);
  if (sum !== expected) {
    throw new Error(
      `⭐ 帧数对账失败：各段求和 ${sum} ≠ 期望 ${expected}（差 ${sum - expected} 帧）\n` +
        `  各段：${segs.map(([a, b]) => `${a}..${b - 1}`).join(' | ')}`,
    );
  }
  return sum;
}
