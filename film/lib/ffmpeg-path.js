/**
 * film/lib/ffmpeg-path.js — 解析 ffmpeg / ffprobe 的**实际路径**。
 *
 * 为什么要有这个文件（`AGENTS.md` §6）：ffmpeg 装在 `E:\ffmpeg\bin` 且在**用户级 PATH**，
 * 但已经在跑的 dsh 进程不继承用户级 PATH —— agent 的 shell 里直接敲 `ffmpeg` 是 CommandNotFound。
 * 所以解析按三级降级：**环境变量 → 已知绝对路径 → PATH**，并且让 `film/check.js` 早期就打印出来，
 * 别等渲到一半才发现找不到（施工说明 §5.4 第 6 条）。
 *
 * 用 `process.env.FFMPEG` / `FFPROBE` 可以在换机器时不用改代码：
 *   $env:FFMPEG = 'D:\tools\ffmpeg\bin\ffmpeg.exe'
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * @typedef {Object} ResolvedBinary
 * @property {string} name 逻辑名（`ffmpeg` / `ffprobe`）
 * @property {string} path 实际可执行路径（或裸名，交给 PATH）
 * @property {'env'|'known'|'path'|'unresolved'} via 在哪一级命中的
 * @property {boolean} exists 文件是否真的存在（`via==='path'` 时可能只是「交给 PATH 试」）
 * @property {?string} version 版本首行（跑得起来才有）
 */

/** 已知的绝对路径候选（本机实测的位置，见 `AGENTS.md` §6）。 @type {string[]} */
const KNOWN_DIRS = [
  'E:\\ffmpeg\\bin',
  'C:\\ffmpeg\\bin',
  'D:\\ffmpeg\\bin',
  '/usr/local/bin',
  '/usr/bin',
  '/opt/homebrew/bin',
];

/** 当前平台的 exe 后缀。 @type {string[]} */
const EXE_SUFFIXES = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

/**
 * 在 PATH 里找一个可执行文件（**不依赖进程 PATH 是否继承**，纯粹按 `process.env.PATH` 文本搜）。
 * @param {string} name
 * @returns {?string} 找到的绝对路径
 */
export function findOnPath(name) {
  const raw = process.env.PATH ?? '';
  const dirs = raw.split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const suffix of EXE_SUFFIXES) {
      const candidate = join(dir, name + suffix);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* 权限/竞态：忽略，继续找 */
      }
    }
  }
  return null;
}

/**
 * 三级解析一个二进制。
 * @param {string} name 逻辑名，不带后缀（如 `ffmpeg`）
 * @param {string} envVar 环境变量名（如 `FFMPEG`）
 * @param {string[]} [knownDirs] 已知绝对路径目录
 * @returns {ResolvedBinary}
 */
export function resolveBinary(name, envVar, knownDirs = KNOWN_DIRS) {
  // 第 1 级：环境变量（可以给目录，也可以给完整文件路径）
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    const candidate = isDir(fromEnv) ? findInDir(fromEnv, name) : fromEnv;
    if (candidate) {
      return { name, path: candidate, via: 'env', exists: existsSync(candidate), version: null };
    }
    // 环境变量给了但不对 —— 不要静默降级，让调用方看到这个信息
    return {
      name,
      path: fromEnv,
      via: 'env',
      exists: false,
      version: null,
    };
  }

  // 第 2 级：已知绝对路径
  for (const dir of knownDirs) {
    const candidate = findInDir(dir, name);
    if (candidate) return { name, path: candidate, via: 'known', exists: true, version: null };
  }

  // 第 3 级：PATH
  const onPath = findOnPath(name);
  if (onPath) return { name, path: onPath, via: 'path', exists: true, version: null };

  // 都没找到：返回裸名，让 spawn 去报错（错误信息里带裸名比带一个假路径清楚）
  return { name, path: name, via: 'unresolved', exists: false, version: null };
}

/**
 * 解析并**试跑**一次，拿到版本首行。这是「真的能用」和「路径看着对」的区别。
 * @param {ResolvedBinary} bin 第一次 `--version` 的参数
 * @param {string[]} [args]
 * @returns {ResolvedBinary} 同一个对象（就地填 `version`）
 */
export function probeVersion(bin, args = ['-version']) {
  const r = spawnSync(bin.path, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) {
    bin.version = `❌ 跑不起来：${r.error.message}`;
  } else if (r.status !== 0) {
    bin.version = `❌ 退出码 ${r.status}：${(r.stderr || '').trim().split('\n')[0] ?? ''}`;
  } else {
    bin.version = (r.stdout || '').split('\n')[0].trim();
  }
  return bin;
}

/**
 * 一次拿到 ffmpeg 与 ffprobe（并试跑）。
 * @returns {{ffmpeg: ResolvedBinary, ffprobe: ResolvedBinary}}
 */
export function resolveFfmpegTools() {
  const ffmpeg = probeVersion(resolveBinary('ffmpeg', 'FFMPEG'));
  const ffprobe = probeVersion(resolveBinary('ffprobe', 'FFPROBE'));
  return { ffmpeg, ffprobe };
}

/**
 * 把解析结果渲染成可读的多行文本。
 * @param {ResolvedBinary} bin
 * @returns {string}
 */
export function describeBinary(bin) {
  const via = { env: '环境变量', known: '已知路径', path: 'PATH', unresolved: '未找到' }[bin.via];
  const head = `${bin.name.padEnd(7)} ${bin.path}  （来源：${via}）`;
  return bin.version ? `${head}\n        ${bin.version}` : head;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @param {string} name
 * @returns {?string}
 */
function findInDir(dir, name) {
  for (const suffix of EXE_SUFFIXES) {
    const candidate = join(dir, name + suffix);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}
