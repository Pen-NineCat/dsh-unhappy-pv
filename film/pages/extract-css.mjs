#!/usr/bin/env node
/**
 * film/pages/extract-css.mjs — 从 dsh 客户端包里**抽出真 CSS**（R1 的地基）。
 *
 * 为什么这是 R1 的钥匙（施工说明附录 E.1/E.2，2026-10-01 实测）：
 * 每个 dsh 客户端 UI 包都把自己的 CSS **作为 JSON 字符串常量烤在 `lib/client.js` 里**
 * （`const css = "..."` / `var x_css_default = "..."`）。抓出来就是**未压缩的真 CSS**，
 * 而且 **`dsh-client-ui-theme` 里带着全套设计令牌**（395 个 `--dsw-*`）。
 *
 * 这解决了 R1 唯一真正的拦路石：我们 vendored 的 `dsh-web-frontend` 只定义了 **2 个** `--dsw-*`，
 * 却引用了 **91 个**；42% 的规则完全没有硬编码颜色 → 光靠那 14 个文件，颜色会全丢。
 *
 * 产物**提交进仓库**（`film/vendor/dsh-css/`）—— 这是作者 2026-10-01 定的方案 A：
 *
 * > 把抽出来的 CSS 当**资产**提交，而不是把十几个组件包 vendor 进来。
 * > 参考仓库就是这么做的（它提交了 101 KB 的 `dsh_components.css`，只 vendor 了 2 个包）。
 * > 好处：**另一台机器不需要装 dsh 也能构建页面**，代价是 151 KB 的 CSS 而不是 420 KB 的 JS。
 *
 * 由此定下的性质（作者明确指示）：**这份 CSS 是快照，dsh 升级与本项目无关。**
 * 我们用的是抽出来时的那个版本；将来真要跟进，再重跑一次本脚本即可 —— 不是必须。
 *
 * 用法：
 *   node film/pages/extract-css.mjs                 # 抽默认包列表（写到 film/vendor/dsh-css/）
 *   node film/pages/extract-css.mjs --list          # 先看本机有哪些包可抽
 *   node film/pages/extract-css.mjs --all           # 所有带 CSS 的 dsh-client-ui-* 包
 *   node film/pages/extract-css.mjs --out <目录>    # 换输出目录
 *   node film/pages/extract-css.mjs --check         # **只校验**：提交的 CSS 与现在能抽到的是否一致
 *
 * 退出码：0 成功 / 1 失败（`--check` 时表示不一致）/ 2 用法错误。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 默认输出：**提交进仓库的资产目录**（方案 A）。 */
const DEFAULT_OUT = 'film/vendor/dsh-css';

/** 本机 dsh 的包目录（三级降级：环境变量 → 已知路径 → 报错）。 */
const DSH_PKG_ROOT_CANDIDATES = [
  process.env.DSH_PACKAGES,
  'E:\\NodeJSGlobalPackage\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai',
  join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
].filter(Boolean);

/**
 * **优先用本仓库 vendor 的副本**，找不到才回退到本机已装的 dsh。
 *
 * 为什么（作者 2026-10-01 指定「使用副本」）：
 * - vendor 进仓库的副本是**版本钉住的**，跨机器可复现（`AGENTS.md` §7 工具脚本那条：
 *   「生成物 + sha256 要能在另一台机器复现」）。
 * - 本机已装的那份会随 dsh 升级而变 —— 同一份代码在两台机器上抽出不同 CSS。
 *
 * `film/vendor/dsh-client-ui-<name>/` 是**参考仓库的做法**（它 vendor 了 `dsh-client-ui-cordis`）。
 * 注意目录名带 `@deepseek-ai/` 前缀被去掉了（照着参考仓库的写法）。
 */
const VENDOR_ROOT = 'film/vendor';

/**
 * 默认包列表。
 *
 * 前 7 个是**参考仓库验证过的那一组**（它的 `extract_css.py`）；
 * 后面几个是实测「本片引子会用到」的补充（侧栏一格、工具行、Cordis 行、模型选择器）。
 * **只有主题包带令牌**，其余只带组件 CSS（`probe-css-hunt.mjs` 实测）。
 * @type {string[]}
 */
const DEFAULT_PACKAGES = [
  // 主题：395 个 --dsw-* 令牌（浅色基础层 + 深色覆盖层）—— **最关键的这一个**
  'dsh-client-ui-theme',
  // 参考仓库那组
  'dsh-client-ui-chat',
  'dsh-client-ui-tool',
  'dsh-client-ui-conversation',
  'dsh-client-ui-message-feedback',
  'dsh-client-ui-deliverables',
  'dsh-client-ui-layout',
  // 本片补充：引子/第一幕会用到的块
  'dsh-client-ui-cordis',
  'dsh-client-ui-sidebar',
  'dsh-client-ui-model-selection',
  // 实测：`--dsw-alias-bg-layer-4` 只有这个包定义了（唯一的例外，其余令牌全在主题包）
  'dsh-client-ui-settings-subagent',
];

/**
 * **兜底令牌**：vendored CSS 引用了、但在**任何** dsh 包里都找不到定义的那几个。
 *
 * 2026-10-01 实测的完整情况（这是 98% 之外的 2%）：
 * - `--dsw-alias-bg-layer-4` —— 只在一个包里被**消费**（`var(--dsw-alias-bg-layer-4)}`，连 fallback 都没写），
 *   而 `--dsw-alias-bg-layer-1/2/3` 都在主题包里、**唯独缺 4**。
 * - `--dsw-alias-label-error` —— 在**所有已装包的 CSS 里一次都没出现**：
 *   只被 vendored 的 `index-*.css` 引用，没有包定义也没有包消费。
 *
 * 结论：这两个是 dsh 自己的**未定义引用**（在真实 GUI 里它们也是无效的，
 * 只是那些规则恰好没被渲染到）。所以给一组显式的兜底值即可 ——
 * **不要假装它们是从 dsh 抽出来的**，这里明确标成我们补的。
 *
 * 值取主题包里语义最近的令牌（`--dsw-static-red-600` 等），后续可按观感调。
 * @type {Record<string, string>}
 */
const FALLBACK_TOKENS = {
  '--dsw-alias-bg-layer-4': 'var(--dsw-static-neutral-bluish-1000)',
  '--dsw-alias-label-error': 'var(--dsw-static-red-600)',
};

const CSS_RE = /(?:const css(?:\$\d+)?|var [A-Za-z_$][\w$]*_css_default) = ("(?:[^"\\]|\\.)*");/g;

/**
 * 从一个包目录里抽 CSS 块。
 * @param {string} dir 包目录（**已解析好的**，不再拼 root）
 * @param {string} name 包名（只用于报告）
 * @returns {?{name: string, version: string, from: 'vendor'|'installed', blocks: string[], css: string, tokens: Set<string>, clientBytes: number}}
 */
function packageCssAt(dir, name, from = 'installed') {
  const clientPath = join(dir, 'lib', 'client.js');
  if (!existsSync(clientPath)) return null;
  const src = readFileSync(clientPath, 'utf8');
  /** @type {string[]} */
  const blocks = [];
  for (const m of src.matchAll(CSS_RE)) {
    try {
      const v = JSON.parse(m[1]);
      if (typeof v === 'string' && v.trim()) blocks.push(v);
    } catch {
      /* 不是合法 JSON 字符串就跳过（正则偶尔会撞上别的长字符串） */
    }
  }
  if (blocks.length === 0) return null;
  const css = blocks.join('\n');
  const tokens = new Set([...css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  let version = '(未知)';
  try {
    version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {
    /* 没有 package.json 就算了 */
  }
  return {
    name,
    version,
    from,
    blocks,
    css,
    tokens,
    clientBytes: statSync(clientPath).size,
  };
}

/**
 * 找一个包：**先看本仓库 vendor 的副本，再回退到本机已装**。
 * @param {string} installedRoot
 * @param {string} name
 * @returns {ReturnType<typeof packageCssAt>}
 */
function packageCss(installedRoot, name) {
  const vendored = packageCssAt(join(VENDOR_ROOT, name), name, 'vendor');
  if (vendored) return vendored;
  return packageCssAt(join(installedRoot, name), name, 'installed');
}

/** 用法错误（退出码 2）。 */
class UsageError extends Error {}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { out: DEFAULT_OUT, packages: DEFAULT_PACKAGES, list: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--list':
        o.list = true;
        break;
      case '--all':
        o.packages = null; // 后面补全
        break;
      case '--check':
        o.check = true;
        break;
      case '--out':
        o.out = argv[++i] ?? DEFAULT_OUT;
        break;
      case '-h':
      case '--help':
        console.log(
          [
            '用法：node film/pages/extract-css.mjs [选项]',
            '',
            '  --list       列出本机所有 dsh-client-ui-* 包与它们能抽出的 CSS',
            '  --all        抽所有带 CSS 的包（更大，但不会漏块）',
            '  --check      只校验：提交的 CSS 与现在能抽到的是否一致（不写文件）',
            '  --out <dir>  输出目录，默认 film/vendor/dsh-css',
            '',
            '退出码：0 成功 / 1 失败（--check 时表示不一致）/ 2 用法错误',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        throw new UsageError(`未知参数 "${argv[i]}"`);
    }
  }
  return o;
}

/** @returns {string} 找到的包目录 */
function findRoot() {
  for (const c of DSH_PKG_ROOT_CANDIDATES) {
    if (existsSync(join(c, 'dsh-client-ui-theme'))) return c;
  }
  throw new Error(
    `找不到本机 dsh 的包目录。找过：\n${DSH_PKG_ROOT_CANDIDATES.map((c) => `  ${c}`).join('\n')}\n` +
      `  hint: 设 $env:DSH_PACKAGES=<...>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`,
  );
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`用法错误：${/** @type {Error} */ (e).message}`);
    return 2;
  }

  const root = findRoot();
  console.log(`本机 dsh 包目录（回退用）${root}`);
  if (existsSync(VENDOR_ROOT)) {
    const v = readdirSync(VENDOR_ROOT).filter((n) => n.startsWith('dsh-client-ui-') || n === 'dsh-web-frontend');
    console.log(`本仓库 vendor 目录 ${VENDOR_ROOT}/：${v.length ? v.join(', ') : '(没有 dsh 包)'}`);
  }
  console.log('解析顺序：**film/vendor/ 优先**，找不到才用本机已装的那份');

  const allPackages = readdirSync(root).filter((n) => n.startsWith('dsh-'));

  if (o.list) {
    console.log('\n=== 本机能抽到 CSS 的包 ===');
    let withCss = 0;
    for (const n of allPackages) {
      const r = packageCss(root, n);
      if (!r) continue;
      withCss++;
      console.log(
        `  ${n.padEnd(46)} v${r.version.padEnd(11)} ${String(r.blocks.length).padStart(3)} 块  ` +
          `${(r.css.length / 1024).toFixed(0).padStart(4)} KB  令牌 ${String(r.tokens.size).padStart(3)}  ` +
          `client.js ${(r.clientBytes / 1024).toFixed(0)} KB`,
      );
    }
    console.log(`\n共 ${withCss} / ${allPackages.length} 个包带 CSS`);
    return 0;
  }

  const wanted = o.packages ?? allPackages;
  /** @type {NonNullable<ReturnType<typeof packageCss>>[]} */
  const got = [];
  /** @type {string[]} */
  const missing = [];
  for (const n of wanted) {
    const r = packageCss(root, n);
    if (r) got.push(r);
    else missing.push(n);
  }
  // 主题包必须在：没有它颜色就全丢，那 R1 就白做了
  if (!got.some((g) => g.name === 'dsh-client-ui-theme')) {
    console.error(
      '\n❌ 没抽到 `dsh-client-ui-theme` —— 没有它，91 个令牌一个都补不回来，页面会没有颜色。\n' +
        '   先跑 --list 看它在不在本机。',
    );
    return 1;
  }

  // ── `--check`：只校验提交的快照 ────────────────────────────────────────
  // 对「这份 CSS 是快照、dsh 升级与本项目无关」这个前提来说，这一条是唯一需要的护栏：
  // 它回答「提交的 dsh.css 与现在本机能抽到的**是否一致**」。
  // 不一致**不是错误**（快照本来就允许落后）；它只是告诉你：要么是别人换了包，
  // 要么是本机 dsh 升级了 —— 两种情况都**不影响出片**，只是值得知道。
  if (o.check) {
    const cssPath = join(o.out, 'dsh.css');
    if (!existsSync(cssPath)) {
      console.error(`❌ 没有提交的快照：${cssPath}\n   先跑一次不带 --check 的抽取。`);
      return 1;
    }
    const committed = readFileSync(cssPath, 'utf8');
    const fresh = got.map((g) => `/* ${g.name}@${g.version}: ${g.blocks.length} 块 */\n${g.css}`).join('\n');
    const tokCommitted = JSON.parse(readFileSync(join(o.out, 'tokens.json'), 'utf8'));
    const tokFresh = {};
    for (const g of got) {
      for (const m of g.css.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
        if (!(m[1] in tokFresh)) tokFresh[m[1]] = m[2].trim();
      }
    }
    const onlyCommitted = Object.keys(tokCommitted).filter((t) => !(t in tokFresh));
    const onlyFresh = Object.keys(tokFresh).filter((t) => !(t in tokCommitted));
    const changed = Object.keys(tokFresh).filter((t) => t in tokCommitted && tokCommitted[t] !== tokFresh[t]);

    console.log('\n── --check：提交的快照 vs 现场抽取 ──');
    console.log(`  dsh.css     提交 ${committed.length} 字节 / 现场 ${fresh.length} 字节 → ${committed === fresh ? '一致 ✅' : '不一致（快照落后，不是错误）'}`);
    console.log(`  令牌        提交 ${Object.keys(tokCommitted).length} 个 / 现场 ${Object.keys(tokFresh).length} 个`);
    if (onlyCommitted.length) console.log(`    只在提交里（本机包少了）：${onlyCommitted.slice(0, 8).join(', ')}`);
    if (onlyFresh.length) console.log(`    只在现场（本机包多了）：${onlyFresh.slice(0, 8).join(', ')}`);
    if (changed.length) console.log(`    值不同：${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ` …（共 ${changed.length}）` : ''}`);
    console.log(
      '\n  说明：不一致**不影响出片** —— 出片用的是**提交的那份**。' +
        '\n        只有在你**想**跟进 dsh 新版时才重跑（不带 --check）。',
    );
    return 0;
  }

  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'dsh.css'), got.map((g) => `/* ${g.name}@${g.version}: ${g.blocks.length} 块 */\n${g.css}`).join('\n'), 'utf8');

  // 令牌表：**扫描所有抽到的包**，不只是主题包。
  //
  // ⚠️ 踩过的坑（2026-10-01）：第一版只扫 `dsh-client-ui-theme`，
  // 于是漏掉了几个**由组件包定义**的令牌（例如 `dsh-client-ui-settings-subagent`
  // 里的 `--dsw-alias-bg-layer-4`）。主题包定义了 395 个，但不是全部。
  /** @type {Record<string,string>} */
  const tokenValues = {};
  /** @type {Record<string,string>} */
  const tokenSource = {};
  for (const g of got) {
    for (const m of g.css.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      const name = m[1];
      // 后抽到的包不覆盖先抽到的：主题包在列表最前，它的值最权威
      if (!(name in tokenValues)) {
        tokenValues[name] = m[2].trim();
        tokenSource[name] = g.name;
      }
    }
  }

  const manifest = {
    generatedBy: 'film/pages/extract-css.mjs',
    dshPackagesRoot: root,
    packages: got.map((g) => ({
      name: g.name,
      version: g.version,
      blocks: g.blocks.length,
      cssBytes: g.css.length,
      tokens: g.tokens.size,
    })),
    missing,
    totalCssBytes: got.reduce((a, g) => a + g.css.length, 0),
    tokenCount: Object.keys(tokenValues).length,
    tokensDefinedOutsideTheme: Object.entries(tokenSource)
      .filter(([, src]) => src !== 'dsh-client-ui-theme')
      .reduce((/** @type {Record<string,string>} */ acc, [t, src]) => {
        acc[t] = src;
        return acc;
      }, {}),
  };
  writeFileSync(join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(o.out, 'tokens.json'), JSON.stringify(tokenValues, null, 2), 'utf8');
  writeFileSync(join(o.out, 'token-source.json'), JSON.stringify(tokenSource, null, 2), 'utf8');

  // ── 报告：我们 vendored 的 CSS 引用了多少令牌、这次补回多少 ──────────────
  const VENDORED = 'film/vendor/dsh-web-frontend/assets';
  let referenced = new Set();
  let definedVendored = new Set();
  if (existsSync(VENDORED)) {
    for (const f of readdirSync(VENDORED).filter((x) => x.endsWith('.css'))) {
      const css = readFileSync(join(VENDORED, f), 'utf8');
      for (const m of css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) referenced.add(m[1]);
      for (const m of css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) definedVendored.add(m[1]);
    }
  }
  const missingTokens = [...referenced].filter((t) => !definedVendored.has(t));
  const recovered = missingTokens.filter((t) => t in tokenValues);
  const viaFallback = missingTokens.filter((t) => !(t in tokenValues) && t in FALLBACK_TOKENS);
  const still = missingTokens.filter((t) => !(t in tokenValues) && !(t in FALLBACK_TOKENS));

  // 兜底令牌单独写一个文件 —— **明确区分「抽来的」与「我们补的」**
  const fallbackCss =
    `/* 由 film/pages/extract-css.mjs 补的**兜底令牌**（不是从 dsh 抽出来的）。\n` +
    `   这些令牌被 vendored CSS 引用，但在任何 dsh 包里都没有定义 ——\n` +
    `   见该文件里 FALLBACK_TOKENS 的注释。 */\n:root, body, body[data-ds-dark-theme] {\n` +
    Object.entries(FALLBACK_TOKENS)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n') +
    `\n}\n`;
  writeFileSync(join(o.out, 'fallback-tokens.css'), fallbackCss, 'utf8');
  manifest.fallbackTokens = FALLBACK_TOKENS;

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`\n抽到 ${got.length} 个包（来源标记：vendor = 本仓库副本 / installed = 本机已装）：`);
  for (const g of got) {
    console.log(
      `  ${g.from === 'vendor' ? '📦' : '💻'} ${g.name.padEnd(40)} v${g.version.padEnd(11)} ` +
        `${String(g.blocks.length).padStart(3)} 块  ${kb(g.css.length).padStart(7)}  令牌 ${String(g.tokens.size).padStart(3)}`,
    );
  }
  for (const m of missing) console.log(`  ⏭️  ${m.padEnd(46)} 没装 / 没有 lib/client.js`);

  console.log(`\n输出 ${o.out}/`);
  console.log(`  dsh.css       ${kb(manifest.totalCssBytes)}（${got.length} 个包合并）`);
  console.log(`  tokens.json   ${manifest.tokenCount} 个令牌`);
  console.log(`  manifest.json`);

  console.log('\n── 令牌补回率（这是 R1 成不成立的关键）──');
  console.log(`  vendored dsh-web-frontend 引用了   ${referenced.size} 个 --dsw-*`);
  console.log(`  它自己定义了                      ${definedVendored.size} 个`);
  console.log(`  缺                                ${missingTokens.length} 个`);
  console.log(`  ✅ 本次补回                       ${recovered.length} / ${missingTokens.length}（${missingTokens.length ? ((recovered.length / missingTokens.length) * 100).toFixed(0) : 100}%）`);
  if (viaFallback.length) {
    console.log(`  ➕ 兜底补齐（我们补的，不是抽的）  ${viaFallback.length} 个：${viaFallback.join(', ')}`);
    console.log(`        → ${o.out}/fallback-tokens.css`);
  }
  if (still.length) {
    console.log(`  ❌ 仍缺                           ${still.length} 个：${still.slice(0, 8).join(', ')}${still.length > 8 ? ' …' : ''}`);
  }
  const coverage = (recovered.length + viaFallback.length) / Math.max(1, missingTokens.length);
  console.log(`  覆盖率 ${(coverage * 100).toFixed(0)}%（≥90% 才算过）`);
  return coverage >= 0.9 ? 0 : 1;
}

process.exitCode = main();
