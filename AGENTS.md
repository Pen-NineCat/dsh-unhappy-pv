# AGENTS.md

> 给在本仓库里干活的 AI 代理（以及未来的协作者）的约定。
> 面向人的介绍在 [README.md](README.md)。
> 本地（不提交）的两份长文：`PersonalWorkaround/dsh-wme-pv-review.md`（参考项目复盘 + 通用技术路线）、
> `PersonalWorkaround/dsh-wme-pv-node-migration.md`（**纯 Node 管线的施工说明**：选型、目录布局、接口契约、分阶段计划、风险与禁止清单）。
> 冲突时：**本文档管纪律与素材事实**，施工说明管工具链与接口细节；施工说明与本文档冲突处以本文档为准（其 §0.1 的临时豁免已在 2026-10-01 回填后失效）。

**标记约定**：`🚧` = **未定 / 条目不完整**。带这个标记的内容只是占位与方向，**不要当成依据**，也不要据此写死代码。
目前 🚧 的条目：整体画面概念、「她」的形象、歌词方案（要不要逐词时间轴、用哪个版本）。
已定并写进本文档的：**24 fps、1920×1080 原生**（2026-10-01）——见 §1 与 §7。

## 1. 项目是什么

`dsh-unhappy-pv`：为《69岁牢二次元 - unhappy（69岁牢二次元 remix）》做一支**逐帧用代码生成**的非官方同人 PV。

🚧 **画面概念：未拍板，本节不完整。** 参考方向是照搬 `world-execute-me-dsh-pv` 的分屏：

- 🚧 **左半**：DeepSeek Harness（dsh）的聊天窗口 —— 逐帧生成 HTML、复用 dsh 自己的 CSS，Playwright 确定性截图；
- 🚧 **右半**：运行着她的那个「世界」—— Node 侧 canvas（`@napi-rs/canvas`，Skia）逐帧绘制；**「她」的形象还没定**；
- 🚧 **合成**：把网页截图当成图形侧的一个图层，统一做镜头运动、后期与编码。

**已经确定的**：非官方同人、逐帧用代码生成、目标曲目是上面那一首、**纯 Node.js 工具链**（见 §5/§7）、
**画面规格 24 fps / 1920×1080 原生**（2026-10-01 定，见 §7）、素材策略见 §3。

**现状**：仓库只有骨架 + 指纹 + 一份 vendor 前端。**渲染代码一行都没写**（连 `film/kit/` 都还没有），
所以 §5 里除 `tools/trim_song.py` 之外的命令都是**计划中的接口**。接口一旦落地，请立刻回来改这份文件——
它宁可短，也不要写不存在的命令。

## 2. 硬规则（不要违反）

1. **音频原件永远不进仓库。** 仓库只存 sha256（`Resource/song.json`）：原曲一个、母版一个，两步校验见 §3。
   `.gitignore` 里有 `*.mp3`/`*.wav`/`*.flac`/`*.m4a` 保险丝，确需提交音频得先说明理由。
2. **`PersonalWorkaround/` 整个目录都不提交。** 它是个人 + 临时工作区：参考项目完整副本、mp3 原件、复盘与施工说明都在里面。
   其中的 `world-execute-me-dsh-pv/` **自带 `.git`** —— 只读参考，不要改它的任何文件，也不要把它 `git add` 进来（会变成嵌套仓库）。
3. **`Resource/` 只放指纹与说明**，不放音频、视频、图片原件。
4. **不要 `git add -A` / `git add .`。** 显式列文件；提交前 `git status` 必须是干净的。
5. **帧号是唯一主键**：`n = Math.round(t * FPS)`。文件名、内存键、命令行参数、缓存键全用它，不要引入第二套编号。
6. **每一帧都是 `t` 的纯函数。** 跨帧状态（残影、上一帧）必须作为**参数**传入（`frame(n, prev = null)`），不能藏在模块级变量里。
7. **禁止 `Math.random()`**：随机一律按帧播种的确定性 PRNG（`frameRng(seed, n)`，见施工说明 §5.5）。
   验收：`Get-ChildItem -Recurse film -Include *.js | Select-String "Math.random"` 必须为空。
8. **所有产物进 `.gitignore`**（`out/`、帧目录、`*_frames.json`、`segments/`、`node_modules/`、`__pycache__/`）。
   凡是被忽略的，都必须能用一条命令重建。
9. **不要从参考项目复制第三方资产**：字体（OFL）、鲸鱼娘立绘（CC BY-NC-SA 4.0）都别搬；
   dsh 前端**用本仓库自己 vendor 的那份**（`film/vendor/dsh-web-frontend/`）。
10. **若将来改帧率（当前锁 24 fps），母版必须重新生成**：`Resource/song.json` 里的 `master` 依赖 fps，改了 fps 就要重跑修剪工具并更新指纹。
11. **原生依赖精确锁版本**（不写 `^`）：Skia 版本变化会改变字形栅格化与重采样结果，直接威胁「同帧双渲一致」。改版本必须重跑对拍。
12. **`film/content/` 只许调 `film/kit/` 的接口，不许直接碰 canvas API。** 这条纪律让「把 `kit/raster.js` 换成 sharp」是一处改动，而不是全仓搜索替换。

## 3. 素材事实（改代码前先读这一节）

目标曲目：**69岁牢二次元 - unhappy（69岁牢二次元 remix）**（专辑 `[三分钟]Unhappy`）。
以下全部由本机原件实测（2026-09-30 解析 MPEG 帧头 + ID3v2 标签；ffprobe 的复核见本节末尾，它给出了**不一样**的数字）：

| | 原曲（发行版） | 母版（成片所对齐） |
|---|---|---|
| sha256 | `2dcc4522…c343a2c` | `d60539b0…4a3dbe8` |
| 时长 | 197.568 s | 197.544 s |
| MPEG 帧 | 8232 | 8231 |
| 字节 | 9,972,236 | 9,971,148（原曲的前缀） |
| 整数视频帧 @24 fps | 4741.632 → 取 4741 | 4741（多出 2.33 ms） |

- 其余参数：MP3 CBR 320 kbps、48 kHz、立体声、1152 采样/帧、960 字节/帧；ID3v2.3（内嵌约 2 MB 封面）、结尾 128 字节 ID3v1。
- **两步校验**（原曲不符 → 只警告；母版不符 → 退出码 1，时间轴不可信）。节点脚本还没写，现在是过渡期：
  `python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3`（纯标准库，用系统解释器，见 §6）
  目标形态是 `node tools/trim-song.mjs check …`（施工说明 Phase 1，**必须与 Python 版逐字节对拍**）。
- **母版怎么来的**：按 MPEG 帧边界做**字节级截断**（不重编码），所以 sha256 与机器、ffmpeg 版本无关；
  母版就是原曲的**字节前缀**，这条性质可以手工复核（截到第 9,971,148 字节）。
- **时间零点 = 母版的第一个解码采样**（与参考项目同一约定）。片头静音长短不一致会让整片平移。
- **已知怪癖**：原件 Xing/Info 头 `frames=8231` 而 `bytes=7902720`（= 8232 帧），头部自身差一帧；母版默认不改头部，
  于是**任何读头部的工具都会把这两份文件报成同一个长度**。要头部自洽用 `--patch-info`，
  但那会得到另一个 sha256（`f119cfba…`）——**两者只能选一个并固定在 `Resource/song.json`**。
- **ffprobe 复核（2026-10-01，用 `E:\ffmpeg\bin\ffprobe.exe`，因为本进程 PATH 里没有它）**：原曲与母版报的时长**都是 `197.504` s**
  ——它读 Xing/Info 头，而母版没改头部，所以**它分不出这两份文件**，不能拿它的时长当帧数依据。
- **由此实测到的陷阱**：`-shortest` 会按 197.504 s 切断视频，**4741 帧的成片变成 4739 帧**（少 2 帧，实测）；
  出片必须用 `-t round(END_T*FPS)/FPS` 或 `-frames:v <总帧数>` 显式定长，别让音频决定片长。
- 🚧 **仍未核实**：解码器延迟/补齐（约 1105 采样）没有核实；修剪工具只保证 MPEG 帧层对齐。

## 4. 目录约定（大部分为计划）

| 路径 | 内容 | 提交 |
|---|---|---|
| `Resource/` | `song.json`（两步 sha256 + 参数 + 已知怪癖 + 复核记录）、`README.md`（为什么没有原件） | ✅ |
| `film/vendor/dsh-web-frontend/` | 截图用的 dsh 前端：`@deepseek-ai/dsh-web-frontend 0.1.7-rc.2`（MIT，DeepSeek），14 个文件约 1.6 MB | ✅ |
| `film/kit/`、`film/engine/`、`film/content/`、`film/pages/`、`film/compose/` | 图形原语 / 时间线与图层 / 场景 / 左侧截图 / 合成 —— **计划中**，模块清单见施工说明 §3.2 | ✅ |
| `film/check.js`、`film/hash.js`、`film/render.js`、`film/render-video.js` | 自检、帧哈希清单、单帧渲染、分段渲染 + ffmpeg —— **计划中** | ✅ |
| `tools/trim-song.mjs` | 母版修剪的 Node 移植（Phase 1）—— **计划中**，目标是让仓库不再需要 Python | ✅ |
| `tools/trim_song.py` | 过渡件：纯标准库，现在能跑（系统解释器）；Phase 1 对拍通过后由作者决定删除 | ✅ |
| `tools/lyrict/` | 上游 `AverageHoarder/lyrict`（MIT）的 vendored 副本。**当前不可运行**：它是 Python 包（`mutagen` + `tqdm`），本仓库已移除 Python 环境 | ✅ |
| `package.json`、`package-lock.json` | Node 侧清单：现在只有 `devDependencies.playwright = "1.63.0"`（精确锁）；`"type"` 仍是 `commonjs`，**还没有 `scripts`、还没有 `@napi-rs/canvas`** | ✅ |
| `input/` | 本机输入：`song.mp3`、`song.master.mp3`、`song.lrc`；除 `README.md` 外全部忽略 | ❌ |
| `data/` | 不含文字的逐词时间轴等小体积清单（Phase 7） | ✅ |
| `out/` | 成片与中间产物（含 `frames.sha256` 帧哈希清单） | ❌ |
| `PersonalWorkaround/` | 个人/临时工作区：参考项目副本、mp3 原件、复盘与施工说明 | ❌ |

目录名一旦定下就**不要改名**（参考项目的教训：代码之间靠相对位置互相找到）。

## 5. 命令

**已落地**（过渡期唯一能跑的素材命令；纯标准库，用系统 Python）：

```bash
python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3
```

退出码：0 通过（原曲不匹配只是警告）；1 母版不匹配或不再是原曲的前缀；2 用法错误。

**计划中**（施工说明 §3.2 / 附录 B；落地后请删掉本段说明）：

```bash
npm.cmd install && npx.cmd playwright install chromium   # 依赖与浏览器（PowerShell 下必须 .cmd，见 §6）

node film/check.js                                        # 环境与素材自检：ffmpeg 路径、两步 sha256、依赖可用性
node tools/trim-song.mjs make  --src input/song.mp3 --out input/song.master.mp3 --fps 24
node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3

node film/pages/gen-frames.js                             # 逐帧 HTML → frames.json
node film/pages/shot.mjs                                  # 确定性截图（七个焊点，见 §7）
node film/render-video.js                                 # 逐帧绘制 → 合成 → out/film.mp4
npm.cmd run all                                           # check + pages + render
```

只重渲某几帧 —— 参考项目最实用的一个开关，**务必保留**（截图侧与渲染侧各一份）：

```bash
node film/pages/shot.mjs seg_frames.json 2769 2770 2800
node film/render-video.js --frames 2769,2770,2800
node film/render-video.js --range 100 200
```

**画布与时间常量必须集中在一处**（计划是 `film/engine/clock.js`：`FPS` / `W` / `H` / `END_T`），不许散落硬编码；
全仓搜 `24` / `1920` / `1080` 时应只在那一处与测试里命中。这也是「将来要 4K 只改常量重渲」的前提。

## 6. 本机环境现状（2026-10-01 复核）

| 项 | 状态 |
|---|---|
| git | 分支 `master`；remote `origin` → `https://github.com/Pen-NineCat/dsh-unhappy-pv`。**表格里的状态类信息一定会过期**：动手前自己跑 `git status`（规则 4 要求提交前干净），别照抄这里的快照 |
| 运行时 | **Node v24.19.0**（`E:\NodeJS`）、npm 11.17.0；**纯 Node 管线，Python 环境已被作者移除**（`pyproject.toml` 与 `uv.lock` 已删） |
| Node 包管理器 | **PowerShell 执行策略禁用了 `npm.ps1` / `npx.ps1`** → 必须用 `npm.cmd` / `npx.cmd`（或 `cmd /c npm ...`）。装依赖只走 `npm.cmd install <pkg>`，不要手工改 `node_modules` |
| Node 依赖 | `playwright` **精确锁 1.63.0**（devDependencies）；`@napi-rs/canvas` **还没装**（Phase 0 装，版本同样精确锁） |
| Playwright 浏览器 | 已就绪（`%LOCALAPPDATA%\ms-playwright`）：`chromium-1243`、`chromium_headless_shell-1243`、`ffmpeg-1011`、`winldd-1007` |
| ffmpeg / ffprobe | 装在 **`E:\ffmpeg\bin`**（ffmpeg / ffprobe / ffplay，`ffprobe N-127021-ge0c94b2d1c-20260930`），并且已在**用户级 PATH**；**但已经在运行的 dsh 进程不继承用户级 PATH** —— agent 的 shell 里直接敲 `ffmpeg` 是 CommandNotFound。代码里按「环境变量 → 已知绝对路径 → PATH」三级解析并让 `film/check.js` 打印结果，别等渲到一半才发现找不到 |
| Python（残留） | 系统解释了还有 `C:\Python314\python.exe`，**只能跑纯标准库脚本**（`tools/trim_song.py` 就属于这类，实测退出码 0）。任何需要第三方包的 Python（`tools/lyrict/`、参考项目的渲染代码）**当前跑不了** |
| vendor 前端 | `film/vendor/dsh-web-frontend/`（`0.1.7-rc.2`）已就位且**未被忽略**，是要提交的素材。**不要硬编码里面的 hash 文件名**（`index-DUvMhLle.css` 这类下次升级就会变），扫 `assets/` 现取 |
| 参考项目工作副本 | `PersonalWorkaround/world-execute-me-dsh-pv/`（自带 `.git`，1586 个已跟踪文件，勿动） |

## 7. 代码约定

**语言与模块**

- **ESM + 纯 JavaScript + JSDoc**：零构建步骤；`package.json` 要改成 `"type": "module"`。
- 不引入 `tsc` 构建链；日后要升级 TS 是平滑的（`.js` → `.ts` 加注解即可）。

**图形侧（Node canvas —— PIL 的等价物）**

- 单帧入口 `frame(n, prev = null)`；画布 **1920×1080**、**24 fps**（定稿值，只从 `film/engine/clock.js` 读）。
  固定六层顺序：背景 → 内容 → 载具 → **角色层（独立画布）** → 装饰与 UI 框 → 后期。
  角色必须是独立一层，否则推拉/滑出/隔离都做不了，这也是「把网页截图当角色」能成立的原因。
- 常量一律缓存（`Map`，替代 `lru_cache`）：字体、字形图集、扫描线、暗角、noise tile、背景。
  **注意 JS 的 `Map` 没有容量上限**：键空间有限的可以无界，其余必须显式设容量并清理。
- **`Image.BOX` 没有等价物**：降采样必须手写「区域算术平均」（`boxDownsample`），不要用 `ctx.drawImage` 缩小去凑。
- **字形图集**：启动时把用到的字符烤进一张位图，之后逐帧只 `drawImage` blit —— 冻结渲染结果（跨机器一致）+ 快一个量级 + 绕开 canvas 文字度量差异。
- **排版自己算**：所有位置来自整数网格（`x = x0 + col * cw`），**不依赖字体度量**做布局决策。
- **alpha 预乘**：只在 `getImageData` / `putImageData` 边界转换，中间全用非预乘。
- 小图算完再放大（暗角 64×36 → 双线性）；调色走 LUT（`Uint8ClampedArray` 查表）而不是逐像素循环。
- 时间重叠/空洞用 `finalize()` 式断言兜住，不要靠人眼发现；**错误信息必须带具体时间点与相邻语段**。

**Web 侧（Playwright）**

七个焊点，少一个帧就会随机闪烁：等 `document.fonts.ready` → 等 `img.decode()` → 用 Web Animations 把 CSS 动画 `pause()` 并按 `t` 设 `currentTime`（在 `innerHTML` **之后**设）→ 相同 body 不重写 DOM → 首帧多等 ~150 ms → 固定 viewport 与 `deviceScaleFactor` → 资源全部本地（`file://`，无 CDN、无系统 emoji）。

**编码侧（ffmpeg）**

喂管道前断言尺寸与像素格式（`W`×`H`、`rgb24`、buffer 长度 `W*H*3`）——这是「花屏」类事故的唯一原因。
并行按**连续帧段**切分（每个 worker 从自己的 `n0` 起跑、`prev = null`），段内 `concat` 不重编码，最后混音 + `+faststart`。
混音时用母版（`input/song.master.mp3`），不要用原曲——尾部那 0.632 帧会让末尾差一帧。
片长**由帧数决定，不由音频决定**：不要用 `-shortest`（它按 ffprobe 报的 197.504 s 切，4741 帧会变成 4739 帧，实测），
用 `-t round(END_T*FPS)/FPS` 或 `-frames:v <总帧数>`；出片后用 §8 的成片帧数护栏对数。

**架构纪律**

- **不猴补丁**：不出现参考项目那种 `kit.her_layer = ...` 式内存替换；用显式接口或注册表。
- **不从参考项目搬历史包袱**：多代叠加目录、`inspect.getsource` + `exec` 改源码、9 份重复的 `main()` 模板，都不要。
- **工具脚本**：sha256 用 `node:crypto`，不要自己实现；任何「生成物 + sha256」的组合都要能在**另一台机器**上复现，
  不能复现的方案要在文档里明说。

## 8. 验证护栏（改完必须跑）

三条 ⭐ 是核心，能挡住「片子渲完才发现第 2000 帧是黑的」：

| 检查 | 做法 |
|---|---|
| ⭐ 帧数对账 | 各段区间求和 == 期望总帧数 `round(END_T * FPS)`（24 fps 下是 4741），文件名编号连续无空洞 |
| ⭐ 同帧双渲比对 | 同一 `n` 渲两次，逐字节比较；不等则打印**差异区域坐标与首个差异像素**（不是一句 "differs"） |
| ⭐ 时间线断言 | 语段表按时间排序、首尾相接、无空洞无重叠，覆盖 `[0, END]` |
| 素材两步校验 | `node film/check.js`（计划中）/ 过渡期 `python tools/trim_song.py check` 退出码 0 |
| 成片帧数 | `ffprobe -count_frames` 数出来的视频帧数 == 期望总帧数（`-shortest` 会偷偷少 2 帧，见 §3） |
| 无空白帧 | 抽样像素标准差，纯色帧（≈0）通常是注入失败 |
| 禁止随机 | 全仓 `Select-String "Math.random"` 为空（规则 7） |
| 帧哈希清单 | `out/frames.sha256`（计划中）：同机重渲必须逐行相同；跨机器允许不同，但必须显式比对并报告差异帧数 |
| 边界帧抽查 | 显式渲 `t=0`、末帧、每个转场的首末帧，人眼看一遍 |
| 仓库卫生 | `git status` 干净；构建跑完出现未跟踪文件 = `.gitignore` 漏了 |

**尚未做的事如实说**：不写「已验证音画同步」「已保证确定性」这种话。目前没有任何逐帧视觉验收；
时长虽已用 ffprobe 复核（§3），但它的读数与物理帧数不一致，只能当参考；
确定性只做到**同机**双渲比对，**跨机器一致性没有验证**（Skia 在不同 CPU 上可能走不同 SIMD 路径）。

## 9. 许可与署名

- **代码**：MIT —— 见 [LICENSE.txt](LICENSE.txt)（Copyright (c) 2026-Present Pen-NineCat）。
- **vendored 的 dsh 前端**（`film/vendor/dsh-web-frontend/`）：MIT，Copyright (c) 2026 DeepSeek；内含字体按各自 OFL 条款（`assets/fonts/`）。
- **vendored 的 `tools/lyrict/`**：MIT，版权归上游 Malte（`AverageHoarder/lyrict`）——见 [tools/lyrict/LICENSE.txt](tools/lyrict/LICENSE.txt)。
  这是本仓库里唯一一份**别人写的**代码；当前不可运行（见 §4），改动请只做必要的 bug 修复并记账。
- **音乐与歌词**：**不随仓库分发，不授予再许可**；`Resource/song.json` 只是指纹，母版只在本地。
- 本片是非官方同人作品，与 DeepSeek、曲作者无隶属或认可关系；发布成片时按平台要求标注 AI 生成内容（若用到）。
- 参考项目的第三方资产（字体 OFL、鲸鱼娘立绘 CC BY-NC-SA 4.0）**不要顺手复制过来**。

## 10. 文档维护

- 改了行为就同时改 `README.md`（面向人）与这份 `AGENTS.md`（面向代理）。
- 两者冲突时，**以 `AGENTS.md` 为准**：它是可执行的约定，README 是介绍。
- 未定的条目一律加 `🚧`；定下来之后**同时**去掉标记并写清结论，不要留下含糊的「大概」。
- `PersonalWorkaround/` 里的两份长文（复盘、施工说明）不是仓库文档，引用它们时请写清「本地文件，不提交」。
- 施工说明里的阶段计划与验收清单**每完成一阶段就回填**（它的附录 C 是施工记录表）；纪律与素材事实有变化则改回本文档。
