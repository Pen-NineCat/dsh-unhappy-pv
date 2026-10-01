/**
 * film/test/run.js — 跑 `film/test/*.test.js` 里的全部用例。
 *
 *   node film/test/run.js
 *   node film/test/run.js timeline        # 只跑文件名里带 timeline 的
 *
 * 退出码：0 全过 / 1 有失败。
 *
 * 注意：`_harness` 是**模块级单例**（用例按 import 顺序累积），所以这里必须
 * 「先把所有测试文件 import 完，再统一 run 一次」—— 每个文件跑一次会把前面的用例重复跑。
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run } from './_harness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`没有匹配的测试文件（filter=${filter ?? '(无)'}）`);
  process.exit(2);
}

for (const f of files) {
  await import(pathToFileURL(join(HERE, f)).href);
}

process.exit(run(`${files.join(' + ')}`));
