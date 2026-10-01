# film/vendor/ —— 从 dsh 发行版里 vendor 进来的东西

> 这里的**包**都是上游 MIT 代码的原样副本（不是我们写的）；
> `dsh-css/` 是**从那些包里抽出来的 CSS 快照**（我们生成的，但内容是 dsh 的）。
> 目的：让这个仓库**在一台没装 dsh 的机器上也能构建网页层**。

## 有什么

| 目录 | 是什么 | 大小 | 许可 | 为什么需要 |
|---|---|---|---|---|
| `dsh-web-frontend/` | `@deepseek-ai/dsh-web-frontend@0.1.7-rc.2` 的 `dist/` 内容 | 1,637 KB / 14 文件 | MIT (DeepSeek) | dsh Web 壳：`index.html` + 2 份 CSS + 2 份 JS + 3 个 Montserrat woff2 |
| `dsh-client-ui-theme/` | `@deepseek-ai/dsh-client-ui-theme@0.1.7-rc.2` | 101 KB / 3 文件 | MIT (DeepSeek) | **R1 的钥匙**：里面烤着全套设计令牌（395 个 `--dsw-*`） |
| `dsh-client-ui-cordis/` | `@deepseek-ai/dsh-client-ui-cordis@0.1.7-rc.2` | 77 KB / 3 文件 | MIT (DeepSeek) | Cordis 插件行的 UI（片子会用到那种卡片） |
| **`dsh-css/`** | **从上面那些包抽出来的 CSS 快照** | **200 KB / 5 文件** | 内容归 dsh（MIT） | **页面实际吃的东西** —— 见下 |

三个包副本**都只留 `lib/client.js` + `package.json` + `LICENSE`**（统一口径）：
`lib/types/*.d.ts`、`lib/index.js`、`README*.md`、`README.i18n.yaml` 对本项目无用，已裁掉
（`extract-css.mjs` 只读 `lib/client.js` 与 `package.json`）。裁前 119 KB/22 文件 → 现 77 KB/3 文件。

## 为什么需要 `dsh-client-ui-theme`（不是可有可无）

只 vendor `dsh-web-frontend` 是**不够**的（2026-10-01 实测）：

- 它的 CSS 引用了 **91 个** `--dsw-*` 令牌，**自己只定义了 2 个**；
- **42% 的规则完全没有硬编码颜色** → 缺令牌就是没有颜色（`var()` 无 fallback → 一片默认黑/透明）。

`dsh-client-ui-theme` 补回其中 **88 个**；剩下 2 个（`--dsw-alias-bg-layer-4`、
`--dsw-alias-label-error`）**在 dsh 的任何包里都没有定义**（上游自己的未定义引用），
由抽取器用 `dsh-css/fallback-tokens.css` 显式兜底 —— 那个文件里注明了**这是我们补的，不是抽来的**。

## 为什么提交 `dsh-css/` 而不是把十几个组件包 vendor 进来（方案 A）

作者 2026-10-01 定的方案。**参考仓库就是这么做的**（实测）：

| | 参考仓库 | 我们 |
|---|---|---|
| git 跟踪的 vendor 包 | **2 个 / 8 个文件** | 3 个包 |
| 提交的抽取产物 | `dsh_components.css` **101 KB** | `dsh-css/dsh.css` **151 KB** |
| 它的抽取脚本 `extract_css.py` 的 7 包列表 | **在本仓库里凑不齐**（那 7 个包一个都没 vendor） | 同 |

**道理**：页面真正吃的是**抽出来的 CSS**，不是那些包的 JS。
所以提交 CSS（151 KB）就够另一台机器构建页面了，不需要为「抽取器能重跑」多付 420 KB 的 JS。

| 方案 | 仓库增加 | 另一台机器能构建页面 | 能重抽 |
|---|---|---|---|
| **A（现在这个）** | **~203 KB CSS** | ✅ **能，不需要 dsh** | ❌ 需要本机有 dsh |
| B（vendor 全部 11 个包） | ~420 KB JS | ✅ 能 | ✅ 能 |

## 「快照」是什么意思（作者明确：**dsh 升级与本项目无关**）

`dsh-css/` 是**抽取当时的快照**。我们出片就用这一份，**dsh 发新版不会影响它、也不需要跟进**。

```powershell
node film/pages/extract-css.mjs --check    # 只校验：提交的快照 vs 现场能抽到的
```

`--check` **不一致不是错误**（快照允许落后）。它只回答「是不是有人换了包 / 本机 dsh 升级了」。
真要跟进新版时才重跑一次不带 `--check` 的抽取。

## 怎么用

```powershell
node film/pages/extract-css.mjs        # 从 vendor 的包抽 CSS → film/vendor/dsh-css/
node film/pages/extract-css.mjs --list # 看本机还有哪些包可抽
```

解析顺序是 **`film/vendor/` 优先 → 本机已装的 dsh 回退**（输出里 📦 = 副本 / 💻 = 本机）。
加了新包就拷到 `film/vendor/dsh-client-ui-<名字>/`（去掉 `@deepseek-ai/` 前缀，与现有的一致）。

产物：

| 文件 | 内容 |
|---|---|
| `dsh-css/dsh.css` | 所有包的 CSS 合并（页面吃这个） |
| `dsh-css/tokens.json` | 令牌名 → 值（395 个） |
| `dsh-css/token-source.json` | 每个令牌**来自哪个包** |
| `dsh-css/fallback-tokens.css` | **我们补的**兜底令牌（与抽来的分开写） |
| `dsh-css/manifest.json` | 包名、版本、块数、体积、覆盖率 |

## 怎么更新（只有你想跟进 dsh 新版时才需要）

```powershell
$src = "<node_modules>\@deepseek-ai\dsh\node_modules\@deepseek-ai"
(Get-Content "$src\dsh-web-frontend\package.json" -Raw | ConvertFrom-Json).version

# 1) 覆盖包副本
Remove-Item -Recurse film/vendor/dsh-web-frontend; New-Item -ItemType Directory film/vendor/dsh-web-frontend
Copy-Item "$src\dsh-web-frontend\dist\*" film/vendor/dsh-web-frontend -Recurse
Copy-Item "$src\dsh-client-ui-theme\lib\client.js" film/vendor/dsh-client-ui-theme\lib\ -Force
Copy-Item "$src\dsh-client-ui-theme\package.json"  film/vendor/dsh-client-ui-theme\ -Force
Copy-Item "$src\dsh-client-ui-theme\LICENSE"       film/vendor/dsh-client-ui-theme\ -Force

# 2) 重抽 + 校验
node film/pages/extract-css.mjs
node film/pages/extract-css.mjs --check
node film/check.js
```

⚠️ **`film/check.js` 里硬编码了 `dsh-web-frontend` 四个关键文件的 sha256**
（来自 `PersonalWorkaround/design-options.md` §1.9，本地文件）。换 `dsh-web-frontend` 之后
那四个值会变，**必须同步更新 `check.js` 里的 `VENDOR_SHA256`**，否则自检报 ❌。
（`dsh-css/` 不参与 `check.js` 的校验 —— 它是我们的产物，不是上游文件。）

## 许可与署名

包副本：**MIT，Copyright (c) 2026 DeepSeek**，各自的 `LICENSE` 在自己目录里。
`dsh-web-frontend/assets/fonts/` 里 3 个 Montserrat woff2 按各自 OFL 条款（`Montserrat-OFL.txt` 同目录）。
`dsh-css/` 的内容同属 dsh（MIT），我们只做了提取与拼接。

**类名的稳定性**（施工说明附录 E 有实测）：`dsh-web-frontend` 的类名是构建产物
（`hHd-Xa_root`），一升级就会漂；而 `dsh-client-ui-*` 抽出来的类名是**可读形式**
（`Sixlwa_bubble`、`DXqwVW_prose`、`lcKema_summaryText`），相对稳，也**更容易读**。
