#!/usr/bin/env node
/**
 * tools/trim-song-parity.mjs — `tools/trim-song.mjs` 与 `tools/trim_song.py` 的**逐字节对拍**。
 *
 * 为什么要有这个脚本（施工说明 §6 Phase 1）：Python 版是过渡件，Node 版要接替它。
 * 「对拍通过」是接替的前提，而它**需要系统 Python 在场** —— 一旦 Python 被卸载，
 * 就只能退化成「按参数核对」。所以趁 Python 还在，把这件事做成**可重跑的脚本**，
 * 而不是一次性手工操作。
 *
 * 对拍内容（施工说明 §6 Phase 1 验收清单）：
 *   1. `make` 产物 sha256 == `d60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8`
 *   2. 产物字节数 == `9,971,148`
 *   3. 两版 `make` 产物**逐字节相同**（不只是 sha 相同）
 *   4. `check` 对「原曲 / 母版 / 错文件」三种输入，退出码与 Python 版一致
 *   5. 母版是原曲的字节前缀
 *
 * 用法：
 *   node tools/trim-song-parity.mjs
 *   node tools/trim-song-parity.mjs --python C:\Python314\python.exe
 *   node tools/trim-song-parity.mjs --src input/song.mp3 --master input/song.master.mp3
 *
 * 退出码：0 全部一致 / 1 有不一致 / 2 用法错误（或 Python 不可用）。
 *
 * 产物写在 `%TEMP%`，**只读 `input/` 里的母版，绝不覆盖它**。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXPECT_SHA = 'd60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8';
const EXPECT_BYTES = 9971148;

const PY_CANDIDATES = ['py', 'python', 'C:\\Python314\\python.exe', 'C:\\Python313\\python.exe'];

const results = [];

/** @param {string} name @param {boolean} pass @param {string} detail */
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  if (detail) console.log(`       ${detail}`);
}

/** 只留最后几行，别把几十行输出糊上去。 */
function tail(s, n = 4) {
  return s.split('\n').slice(-n).join('\n       ');
}

/** 跑一条命令（不抛，返回退出码与合并输出）。 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) return { code: -1, out: `spawn 失败：${r.error.message}` };
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** 找一个能跑起来的 Python 解释器。 @param {?string} explicit */
function findPython(explicit) {
  for (const p of explicit ? [explicit] : PY_CANDIDATES) {
    const r = spawnSync(p, ['-c', 'print(1)'], { encoding: 'utf8', windowsHide: true });
    if (!r.error && r.status === 0) return p;
  }
  return null;
}

/** 文件 sha256。 @param {string} path */
function sha256(path) {
  const fd = openSync(path, 'r');
  const h = createHash('sha256');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * 两个文件是否逐字节相同；不同就报出**首个不同的字节偏移**。
 * @param {string} a @param {string} b
 * @returns {{same: boolean, reason: string}}
 */
function sameBytes(a, b) {
  const sa = statSync(a).size;
  const sb = statSync(b).size;
  if (sa !== sb) return { same: false, reason: `字节数不同：${sa} vs ${sb}` };
  const fa = openSync(a, 'r');
  const fb = openSync(b, 'r');
  try {
    const A = Buffer.allocUnsafe(1 << 20);
    const B = Buffer.allocUnsafe(1 << 20);
    let off = 0;
    for (;;) {
      const na = readSync(fa, A, 0, A.length, null);
      const nb = readSync(fb, B, 0, B.length, null);
      if (na !== nb) return { same: false, reason: `读取长度不同 @${off}` };
      if (na === 0) break;
      if (!A.subarray(0, na).equals(B.subarray(0, nb))) {
        for (let i = 0; i < na; i++) {
          if (A[i] !== B[i]) return { same: false, reason: `首个不同字节 @${off + i}` };
        }
      }
      off += na;
    }
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
  return { same: true, reason: '' };
}

/** `b` 是不是 `a` 的前缀。 @param {string} a @param {string} b */
function isPrefix(a, b) {
  const n = statSync(b).size;
  const fa = openSync(a, 'r');
  const fb = openSync(b, 'r');
  try {
    const A = Buffer.allocUnsafe(1 << 20);
    const B = Buffer.allocUnsafe(1 << 20);
    let off = 0;
    while (off < n) {
      const want = Math.min(A.length, n - off);
      const na = readSync(fa, A, 0, want, null);
      const nb = readSync(fb, B, 0, want, null);
      if (na !== nb) return false;
      if (!A.subarray(0, na).equals(B.subarray(0, nb))) return false;
      if (na === 0) break;
      off += na;
    }
    return off === n;
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { src: 'input/song.mp3', master: 'input/song.master.mp3', python: undefined };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--src':
        o.src = argv[++i];
        break;
      case '--master':
        o.master = argv[++i];
        break;
      case '--python':
        o.python = argv[++i];
        break;
      case '-h':
      case '--help':
        console.log(
          '用法：node tools/trim-song-parity.mjs [--src <原曲>] [--master <母版>] [--python <解释器>]',
        );
        process.exit(0);
        break;
      default:
        console.error(`用法错误：未知参数 "${argv[i]}"`);
        process.exit(2);
    }
  }
  return o;
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log('───────────────────────────────────────────────────────────');
  if (failed.length === 0) {
    console.log(`结论：对拍通过（${results.length}/${results.length}）。Node 版可以接替 Python 版。`);
    return 0;
  }
  console.log(`结论：对拍失败（${results.length - failed.length}/${results.length}）—— 逐条看上面的 ❌。`);
  return 1;
}

function main() {
  const o = parseArgs(process.argv.slice(2));

  console.log('── trim-song 对拍（Node ⇄ Python）──────────────────────────');
  if (!existsSync(o.src)) {
    console.error(`原曲不在：${o.src}（它只在本地，仓库里只有 sha256）`);
    return 2;
  }
  if (!existsSync(o.master)) {
    console.error(`母版不在：${o.master}`);
    return 2;
  }
  const py = findPython(o.python);
  if (!py) {
    console.error(
      '找不到可用的 Python 解释器 —— **对拍无法进行**。\n' +
        '  这时只能退化为「按参数核对」：核对现有母版的 sha256 与字节数是否等于已知值。\n' +
        '  退化的结论必须写成「未与 Python 版逐字节对拍」（施工说明 §6 Phase 1 的 ⚠️）。',
    );
    return 2;
  }
  console.log(`原曲    ${o.src}`);
  console.log(`母版    ${o.master}（对拍只读它，不覆盖）`);
  console.log(`Python  ${py}`);
  console.log('');

  const dir = join(tmpdir(), `dsh-unhappy-pv-parity-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const pyOut = join(dir, 'master.py.mp3');
  const jsOut = join(dir, 'master.js.mp3');
  const badPath = join(dir, 'not-a-master.mp3');
  const missing = join(dir, 'nope.mp3');

  try {
    // ── 1) 两版 make ────────────────────────────────────────────
    console.log('[1] make');
    const pyMake = run(py, ['tools/trim_song.py', 'make', '--src', o.src, '--out', pyOut, '--fps', '24']);
    check('Python 版 make 退出 0', pyMake.code === 0, pyMake.code === 0 ? '' : tail(pyMake.out));

    const jsMake = run(process.execPath, [
      'tools/trim-song.mjs',
      'make',
      '--src',
      o.src,
      '--out',
      jsOut,
      '--fps',
      '24',
    ]);
    check('Node 版 make 退出 0', jsMake.code === 0, jsMake.code === 0 ? '' : tail(jsMake.out));

    if (pyMake.code !== 0 || jsMake.code !== 0) {
      console.log('\n产物没生成，后续对拍跳过。');
      return finish();
    }

    // ── 2) 产物比对 ────────────────────────────────────────────
    console.log('[2] 产物比对');
    const bytes = sameBytes(pyOut, jsOut);
    check('两版产物逐字节相同', bytes.same, bytes.reason);

    const jsSha = sha256(jsOut);
    const pySha = sha256(pyOut);
    check(`Node 版 sha256 == 期望值`, jsSha === EXPECT_SHA, `实际 ${jsSha}`);
    check('两版 sha256 相同', jsSha === pySha, `Node ${jsSha}\n       Py   ${pySha}`);

    const size = statSync(jsOut).size;
    check(`Node 版字节数 == ${EXPECT_BYTES.toLocaleString('en-US')}`, size === EXPECT_BYTES, `实际 ${size}`);

    // ── 3) 结构 ────────────────────────────────────────────────
    console.log('[3] 结构');
    check('make 产物是原曲的字节前缀', isPrefix(o.src, jsOut), '');
    const masterSha = sha256(o.master);
    check('现有母版 sha256 == 期望值', masterSha === EXPECT_SHA, `实际 ${masterSha}`);
    const sameAsExisting = sameBytes(o.master, jsOut);
    check('现有母版与 make 产物逐字节相同', sameAsExisting.same, sameAsExisting.reason);

    // ── 4) check 的退出码（同一组输入喂两版）────────────────────
    console.log('[4] check 退出码（原曲 / 母版 / 错文件）');
    const masterBuf = readFileSync(o.master);
    writeFileSync(badPath, masterBuf.subarray(0, masterBuf.length - 1)); // 「像母版但被改过」

    /** @type {[string, string[], number][]} */
    const cases = [
      ['--src <原曲> --master <母版>', ['--src', o.src, '--master', o.master], 0],
      ['--src <原曲> --master <错文件>', ['--src', o.src, '--master', badPath], 1],
      ['--src <不存在> --master <母版>', ['--src', missing, '--master', o.master], 0],
      ['--src <不存在> --master <母版> --src-required', ['--src', missing, '--master', o.master, '--src-required'], 1],
      ['--master <不存在>', ['--src', o.src, '--master', missing], 1],
    ];
    for (const [label, extra, expect] of cases) {
      const a = run(py, ['tools/trim_song.py', 'check', ...extra]);
      const b = run(process.execPath, ['tools/trim-song.mjs', 'check', ...extra]);
      const ok = a.code === b.code && a.code === expect;
      check(
        `退出码一致：${label}（期望 ${expect}）`,
        ok,
        `Py=${a.code} Node=${b.code}` + (ok ? '' : `\n       ${tail(a.out)}\n       ${tail(b.out)}`),
      );
    }

    return finish();
  } finally {
    for (const f of [pyOut, jsOut, badPath]) {
      try {
        unlinkSync(f);
      } catch {
        /* 不存在就算了 */
      }
    }
    try {
      rmdirSync(dir);
    } catch {
      /* 目录非空就算了 */
    }
  }
}

process.exit(main());
