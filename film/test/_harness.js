/**
 * film/test/_harness.js — 极简测试骨架（零依赖、零构建，`node film/test/run.js` 直接跑）。
 *
 * 为什么不用 `node:test`：本项目的验收判据是「报错信息带具体时间点与相邻语段」这种**文本形态**，
 * 自带的 harness 更直接，也不用多一层 reporter 配置。
 */

import { createRequire } from 'node:module';

/** @type {{name: string, fn: Function}[]} */
const cases = [];
/** @type {string} */
let suite = '(未命名套件)';

/**
 * 声明一个套件。
 * @param {string} name
 * @param {() => void} body 里面调 `test()`
 */
export function describe(name, body) {
  const prev = suite;
  suite = name;
  body();
  suite = prev;
}

/**
 * 登记一个用例。
 * @param {string} name
 * @param {Function} fn 抛异常 = 失败
 */
export function test(name, fn) {
  cases.push({ name: `${suite} › ${name}`, fn });
}

/** 断言为真。 @param {any} v @param {string} msg */
export function ok(v, msg) {
  if (!v) throw new Error(`断言失败（期望真值）：${msg}`);
}

/** 断言相等（===）。 @param {any} a @param {any} b @param {string} msg */
export function eq(a, b, msg) {
  if (a !== b) throw new Error(`断言失败：${msg}\n  实际 ${JSON.stringify(a)}\n  期望 ${JSON.stringify(b)}`);
}

/**
 * 断言函数会抛，并返回它抛出的错误（用来检查**报错文本**的质量）。
 * @param {Function} fn
 * @param {string} msg
 * @returns {Error}
 */
export function throws(fn, msg) {
  try {
    fn();
  } catch (e) {
    return /** @type {Error} */ (e);
  }
  throw new Error(`断言失败（本该抛错但没有）：${msg}`);
}

/**
 * 断言字符串包含某段子串（用于护栏错误信息的可定位性）。
 * @param {string} haystack
 * @param {string} needle
 * @param {string} msg
 */
export function contains(haystack, needle, msg) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `断言失败：${msg}\n  错误信息里找不到 ${JSON.stringify(needle)}\n  实际信息：\n${indent(haystack)}`,
    );
  }
}

/** @param {string} s */
function indent(s) {
  return s
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * 跑所有登记的用例。
 * @param {string} label
 * @returns {number} 退出码（0 全过 / 1 有失败）
 */
export function run(label) {
  console.log(`── ${label} ────────────────────────────────`);
  let failed = 0;
  for (const c of cases) {
    try {
      c.fn();
      console.log(`  ✅ ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${c.name}`);
      console.log(indent(/** @type {Error} */ (e).message || String(e)));
    }
  }
  console.log(`── ${cases.length - failed}/${cases.length} 通过 ──`);
  return failed === 0 ? 0 : 1;
}

/** `createRequire` 转发，给需要 require 原生包的用例用。 */
export const require_ = createRequire(import.meta.url);
