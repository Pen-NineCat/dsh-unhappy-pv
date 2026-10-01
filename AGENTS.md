# AGENTS.md

> 给在本仓库里干活的 AI 代理（以及未来的协作者）的约定。
> 面向人的介绍在 [README.md](README.md)。
> 本地（`PersonalWorkaround/`，不提交）的三份长文，各有分工：
> - `dsh-wme-pv-review.md` —— 参考项目复盘 + 通用技术路线。
> - `dsh-wme-pv-node-migration.md` —— **施工说明**：选型、接口契约、分阶段计划、风险、禁止清单、施工记录（附录 C）。
> - `design-options.md` —— **画面规格**：现行结论、任务清单（T0–T9）、验收标准、**⛔ 待拍板项**、按时间轴的现行设计。
>
> 冲突时：**本文档管纪律与素材事实**；施工说明管工具链与接口细节；画面规格管画面。三者的临时豁免（施工说明 §0.1）已随本轮回填失效。

**标记约定**：`🚧` = **未定 / 未实现 / 条目不完整**。带这个标记的内容只是占位与方向，**不要当成依据**。
目前 🚧 的条目：
- **画面内容大部分未实现** —— 引子的**网页层**已实现（`film/pages/intro.js`），**图形侧**登记的还是管线自检画面（`content/example.js`）；
- **画面规格里的 ⛔ 待拍板项**（第二幕、结尾、层的长相、第一次 `love me`、一个 LRC 时间戳的真值等）—— 见画面规格 §1.4，**不要自行决定**；
- **歌词方案**（要不要逐词时间轴、用哪个版本），`data/timing/` 未落地。

已定并写进本文档的：**24 fps、1920×1080 原生、4741 帧**；**纯 Node 工具链**；`film/engine/clock.js` 是常量唯一来源。

## 1. 项目是什么

`dsh-unhappy-pv`：为《69岁牢二次元 - unhappy（69岁牢二次元 remix）》做一支**逐帧用代码生成**的非官方同人 PV。
两个渲染器：**网页层**（Playwright 逐帧截图，当图层用）与**图形层**（`@napi-rs/canvas`，Skia），合成、后期、编码都在图形侧。

**现状（2026-10-01 实测）**：

| | 状态 |
|---|---|
| **出片管线** | ✅ **完成**。Phase 0–7 全部落地；`node film/check.js` 退出 0、`node film/test/run.js` **209/209**、`node film/guard.js` **14/14**（三条 ⭐ 全过，1 条 ⚠️ 需人眼） |
| **画面内容** | 🔸 **部分**。引子的**网页层已实现**（`film/pages/intro.js`，`body.js` 默认变体 `intro`；帧 0–419 已渲到 `out/prelude/`）。**图形侧仍登记管线自检**：`film/engine/content.js`（内容的唯一注册点）四段都指向 `content/example.js` —— 引子的画布部分与第一幕之后**未写** |
| 网页层的路线 | 已拍板 **R1**（vendored CSS + 自建 DOM + 自己的令牌），且**引子这一块已实现**（`film/pages/intro.js`）；其余段落待做 |
| 诚实边界 | `--full`（4741 帧整片）**没跑过**；**跨机器确定性没有验证**；`out/frames.sha256` 还没生成过；没有任何 PV 画面的视觉验收 |

## 2. 硬规则（不要违反）

1. **音频原件永远不进仓库。** 仓库只存 sha256（`Resource/song.json`）：原曲一个、母版一个，两步校验见 §3。
   `.gitignore` 里有 `*.mp3`/`*.wav`/`*.flac`/`*.m4a` 保险丝，确需提交音频得先说明理由。
2. **`PersonalWorkaround/` 整个目录都不提交。** 参考项目完整副本、mp3 原件、复盘 / 施工说明 / 画面规格都在里面。
   其中的 `world-execute-me-dsh-pv/` **自带 `.git`** —— 只读参考，不要改它的任何文件，也不要把它 `git add` 进来。
3. **`Resource/` 只放指纹与说明**，不放音频、视频、图片原件。
4. **不要 `git add -A` / `git add .`。** 显式列文件；提交前 `git status` 必须是干净的（`film/guard.js` 的「仓库卫生」一条会自动查）。
5. **帧号是唯一主键**：`n = Math.round(t * FPS)`。文件名、内存键、命令行参数、缓存键全用它。
6. **每一帧都是 `t` 的纯函数。** 跨帧状态（残影、上一帧）只能作为**参数**传入（`frame(n, prev = null)`），不能藏模块级变量。
7. **禁止 `Math.random()`**：随机一律按帧播种的确定性 PRNG（`frameRng(seed, n)`）。护栏里有自动检查。
8. **所有产物进 `.gitignore`**（`out/`、帧目录、`*_frames.json`、`segments/`、`node_modules/`）。凡被忽略的都要能用一条命令重建。
9. **不要从参考项目复制第三方资产**：字体（OFL）、鲸鱼娘立绘（CC BY-NC-SA 4.0）都别搬；dsh 素材**用本仓库自己 vendor 的那份**。
10. **若将来改帧率（当前锁 24 fps），母版必须重新生成**：`Resource/song.json` 里的 `master` 依赖 fps。
11. **原生依赖精确锁版本**（不写 `^`/`~`）：Skia 版本变化会改变字形栅格化与重采样结果，直接威胁「同帧双渲一致」。改版本必须重跑对拍。
12. **`film/content/` 只许调 `film/kit/` 与 `film/engine/` 的接口**，不许直接碰 canvas API；**不猴补丁**（不出现参考项目那种内存替换宿主函数的写法）。
13. **段区间一律半开 `[start, end)`**，边界帧归后一段；**画面轴与声音轴是两张独立的段表**，各自半开、各自无重叠。引子是 `[0, 419)`，`n=419` 是开词帧，属于下一段。

## 3. 素材事实（改代码前先读这一节）

目标曲目：**69岁牢二次元 - unhappy（69岁牢二次元 remix）**（专辑 `[三分钟]Unhappy`）。
以下由本机原件实测（2026-09-30 解析 MPEG 帧头 + ID3v2 标签；ffprobe 复核见本节末，它给出**不一样**的数字）：

| | 原曲（发行版） | 母版（成片所对齐） |
|---|---|---|
| sha256 | `2dcc4522…c343a2c` | `d60539b0…4a3dbe8` |
| 时长 | 197.568 s | 197.544 s |
| MPEG 帧 | 8232 | 8231 |
| 字节 | 9,972,236 | 9,971,148（原曲的前缀） |
| 覆盖的整数视频帧 @24 fps | 4741.632 → 取 4741 | 4741（多 2.33 ms） |

- 其余参数：MP3 CBR 320 kbps、48 kHz、立体声、1152 采样/帧、960 字节/帧；ID3v2.3（内嵌约 2 MB 封面）、结尾 128 字节 ID3v1。
- **两步校验**：原曲不符 → **只警告**；母版不符 → **退出码 1**，时间轴不可信。
  `node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3`（`npm run trim -- check …`）。
  过渡期的 Python 版 `python tools/trim_song.py check …` 仍可跑（纯标准库，系统解释器）；两版的一致性由
  `node tools/trim-song-parity.mjs` 逐字节对拍（**需要系统 Python 在场**）。
- **母版怎么来的**：按 MPEG 帧边界做**字节级截断**（不重编码），sha256 与机器、ffmpeg 版本无关；母版就是原曲的**字节前缀**。
- **时间零点 = 母版的第一个解码采样**。片头静音长短不一致会让整片平移。
- **已知怪癖**：原件 Xing/Info 头 `frames=8231` 而 `bytes=7902720`（= 8232 帧），头部自身差一帧；母版默认不改头部，
  于是**任何读头部的工具都会把这两份文件报成同一个长度**（实测 ffprobe 对两者都报 `197.504` s）。
- **由此实测到的陷阱**：`-shortest` 会按 197.504 s 切断视频，**4741 帧的成片变成 4739 帧**。
  片长必须由帧数决定（渲染器已用 `-frames:v`）。
- 🚧 **仍未核实**：解码器延迟/补齐（约 1105 采样）没有核实；修剪工具只保证 MPEG 帧层对齐。

## 4. 目录约定

| 路径 | 内容 |
|---|---|
| `film/kit/` | 图形原语：`canvas.js`（画布/图层/合成算子）、`raster.js`（LUT、通道、box 降采样、可分离高斯、Sobel）、`text.js`（字形图集与排版）、`color.js`、`noise.js`、`pixels.js`（像素/字节边界的**唯一**转换点）、`post.js` + `post-config.js` |
| `film/engine/` | `clock.js`（`FPS`/`W`/`H`/`END_T` **唯一来源**）、`timeline.js`（段表 + `finalize` 断言）、`layers.js`（六层顺序，写成数据）、**`content.js`（内容的唯一注册点）**、`frame.js`（单帧入口）、`camera.js`、`transitions.js` |
| `film/content/` | **图形侧**场景。现在只有 `example.js` = 管线自检画面；**引子的画布部分未写** |
| `film/pages/` | 网页层：**`intro.js`（引子的真页面，帧 0–419）**、`body.js`（`body(t) -> HTML`，`intro` / `probe` 两个变体）、`gen-frames.js`（→ `frames.json` + 舞台 HTML）、`shot.mjs`（Playwright 截图器 + `--smoke`/`--jitter-check`/`--scroll-check`）、`preview.mjs`（全览表 / 预览片 / 逐帧变化表）、`extract-css.mjs`（抽 CSS → `vendor/dsh-css/`）、`stage-html.js`、`dsh-blocks.js`、`dsh-theme.js`、`dsh-composer.js`、`probe.js`、`theme-probe.js` |
| `film/compose/` | `overlay.js`（截图当图层）、`lead.js`（主导权淡化）、`shots.js`（缺帧**报错**）、`track-layer.js`（轨道层注入，显式接口） |
| `film/lib/` | `ffmpeg-path.js`（三级路径解析）、`frame-segments.js`（连续段切分）、`render-worker.js`、`static-server.js`、`dsh-web.js` |
| `film/{check,guard,hash,render,render-video}.js` | 自检、全量护栏、帧哈希清单、单帧渲染、分段渲染 + 编码 |
| `film/test/` | `run.js` 测试入口 + 各套件 + `perf-baseline.js` + 一次性探针（`probe-*.mjs`、`compare-*.mjs`） |
| `film/vendor/` | dsh 素材：`dsh-web-frontend`、`dsh-client-ui-theme`、`dsh-client-ui-cordis` 三个 MIT 包副本 + 抽出的 `dsh-css/`（**页面实际吃的是它**）。怎么来的、怎么更新、许可，见 `film/vendor/README.md` |
| `tools/` | `trim-song.mjs`（Node）、`trim-song-parity.mjs`（对拍）、`trim_song.py`（**过渡件**，等作者拍板删除）、`lyrict/`（vendored，**当前不可运行**：Python 包，本仓库已移除 Python 环境） |
| `package.json` | ESM（`"type": "module"`）、`engines.node >= 20`；`dependencies` 只有 `@napi-rs/canvas`（精确锁），`devDependencies` 只有 `playwright`（精确锁）；scripts 见 §5 |
| `Resource/`、`input/`、`out/`、`data/` | 指纹 / 本机输入（忽略） / 产物（忽略） / `data/timing/` **未落地**（🚧） |
| `PersonalWorkaround/` | 个人工作区（忽略）：参考项目副本、音频原件、复盘 / 施工说明 / 画面规格 |

目录名一旦定下就**不要改名**。

## 5. 命令

**npm scripts**（`package.json`；PowerShell 下 npm/npx 必须用 `.cmd`）：

```bash
npm.cmd install && npx.cmd playwright install chromium

npm.cmd run check          # node film/check.js   环境与素材自检（退出码 0/1/2）
npm.cmd test               # node film/test/run.js
npm.cmd run guard          # node film/guard.js   快档：静态 + 48 帧真渲
npm.cmd run guard:full     # node film/guard.js --full   整片 4741 帧（慢；**从未跑过**）
npm.cmd run trim -- check --src input/song.mp3 --master input/song.master.mp3

npm.cmd run pages          # gen-frames → shot
npm.cmd run prelude        # 引子 [0,419]：gen-frames → shot → preview（out/prelude、out/preview）
npm.cmd run preview -- --range 0 419       # 单独重出全览表 / 预览片
npm.cmd run smoke          # shot.mjs --smoke --seconds 4（10 帧冒烟 + 同帧双渲）
npm.cmd run render         # render-video.js → out/film.mp4
npm.cmd run master         # 无损母版 out/film.master.mkv + 交付转码
npm.cmd run all            # check + test + pages + render
```

**只重渲某几帧**（参考项目最实用的开关，务必保留）：

```bash
node film/render-video.js --range 100 200
node film/render-video.js --frames 2769,2770,2800
node film/render-video.js --workers 8 --keep-segments --no-audio --manifest
```

**vendor 与其它工具**：

```bash
node film/pages/extract-css.mjs            # 从 film/vendor 的包抽 CSS → film/vendor/dsh-css/
node film/pages/extract-css.mjs --check    # 只校验「提交的快照 vs 现场能抽到的」（不一致不算错误）
node film/test/perf-baseline.js            # 后期/算子性能基线

python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3   # 过渡期
```

**画面硬约束（来自本地画面规格 §1.1，写代码时必须遵守）**：

- 全片**无声**（只有歌声本身）→ 一帧硬切就是最大音量；同一时刻**在场通道 ≤ 3**。
- **语言分工**：dsh 的 UI 文案是**中文**；模型产出的内容是**英文**；人的文字是**中文**。
- 遇到「整块 / 全部 / 等」这类模糊限定词**先问再动**；涉及「清屏 / 清除 / 重置」**先确认作用域**。
- 🚧 的画面项（画面规格 §1.4 的 ⛔ 表）**不要自行决定**。

## 6. 本机环境现状（2026-10-01 实测）

| 项 | 状态 |
|---|---|
| git | 分支 `master`；remote `origin` → `https://github.com/Pen-NineCat/dsh-unhappy-pv`。**状态类信息一定会过期**：动手前自己跑 `git status`（规则 4），别照抄快照 |
| 运行时 | **Node v24.19.0**（`E:\NodeJS`）、npm 11.17.0；**纯 Node 管线，Python 环境已被作者移除**（`pyproject.toml` / `uv.lock` 已删） |
| Node 包管理器 | **PowerShell 执行策略禁用了 `npm.ps1` / `npx.ps1`** → 必须 `npm.cmd` / `npx.cmd`（或 `cmd /c npm ...`）。装依赖只走 `npm.cmd install <pkg>`，不要手工改 `node_modules` |
| Node 依赖 | `@napi-rs/canvas` **1.0.9**（dependencies，精确锁）、`playwright` **1.63.0**（devDependencies，精确锁） |
| Playwright 浏览器 | 已就绪（`%LOCALAPPDATA%\ms-playwright`）：`chromium-1243`、`chromium_headless_shell-1243`、`ffmpeg-1011`、`winldd-1007` |
| ffmpeg / ffprobe | 装在 **`E:\ffmpeg\bin`**（`ffprobe N-127021-ge0c94b2d1c-20260930`），已在**用户级 PATH**；**但已运行的 dsh 进程不继承它** —— agent 的 shell 里直接敲 `ffmpeg` 是 CommandNotFound。代码里走 `film/lib/ffmpeg-path.js` 的三级解析（环境变量 → 已知绝对路径 → PATH），`film/check.js` 会打印实际路径 |
| Python（残留） | 只有 `C:\Python314\python.exe`，**只够跑纯标准库脚本**（`tools/trim_song.py`、`trim-song-parity.mjs` 里的对拍）。`tools/lyrict/` 与参考项目的渲染代码**当前跑不了** |
| 测量值 | `check` 退出 0；`test` **209/209**；`guard` **14/14**（1 条 ⚠️ 需人眼：边界帧出图）；`out/frames.sha256` **未生成**（跑 `render-video.js --manifest`） |
| 参考项目工作副本 | `PersonalWorkaround/world-execute-me-dsh-pv/`（自带 `.git`，勿动） |

## 7. 代码约定

**语言与模块**

- **ESM + 纯 JavaScript + JSDoc**，零构建步骤；不引入 `tsc`。
- **`film/engine/clock.js` 是 `FPS`/`W`/`H`/`END_T` 的唯一来源**；全仓搜 `24`/`1920`/`1080` 只应在它和测试里命中。
- **`film/engine/content.js` 是内容的唯一注册点**：`frame.js` 不 import 任何 `content/` 的东西，只查已登记的段表。换内容 = 改这一个文件。

**图形侧（Node canvas）**

- 单帧入口 `frame(n, prev = null)`；**画布 1920×1080、24 fps**。
- 六层顺序不可变，且**写成数据**：背景 → 内容 → 载具 → **角色层（独立画布）** → 装饰与 UI 框 → 后期。
  角色独立成层，才能对它做推拉/滑出/隔离 —— 这也是「网页截图当角色」成立的前提。
- 常量一律缓存（`Map`，替代 `lru_cache`）：字体、字形图集、扫描线、暗角、noise tile、背景。**`Map` 没有容量上限**：键空间有限的可以无界，其余必须显式设容量并清理。
- **`Image.BOX` 没有等价物**：降采样必须手写区域平均；**字形烤图集**（启动时把用到的字符渲进位图，逐帧只 `drawImage`）；**排版自己算**（整数网格 `x = x0 + col * cw`，不靠字体度量做布局）。
- **alpha 预乘**只在 `film/kit/pixels.js` 的边界转换，中间全用非预乘。
- 小图算完再放大（暗角 64×36 → 双线性）；调色走 LUT；`gaussianBlur` 用可分离实现（sigma ≠ PIL 的 radius，靠视觉对拍，别照抄）。

**网页层（Playwright）**

- **七个焊点一个都不能少**：等 `document.fonts.ready` → 等 `img.decode()` → 用 Web Animations 把 CSS 动画 `pause()` 并按 `t` 设 `currentTime`（在 `innerHTML` **之后**）→ 相同 body 不重写 DOM → 首帧多等 ~150 ms → 固定 viewport 与 `deviceScaleFactor` → 资源全部本地（`file://`，无 CDN、无系统 emoji）。
- **不要硬编码 vendor 里的 hash 文件名**（`index-DUvMhLle.css` 这类下次升级就变）：扫目录现取。
- 页面**实际吃的是 `film/vendor/dsh-css/dsh.css`**（快照），不是那些包的 JS；快照允许落后，用 `extract-css.mjs --check` 判断有没有人换了包。
- `film/check.js` 里硬编码了 `dsh-web-frontend` 四个关键文件的 sha256：**换 vendor 必须同步更新它**。

**合成**：截图尺寸 = 目标矩形尺寸（1:1 贴入）；缺帧**报错并指出帧号**，不要静默跳过；主导权（`LEAD`/`COVER`）用显式表，不要猴补丁。

**编码（ffmpeg）**

- 喂管道前断言 `W`×`H`、`rgb24`、buffer 长度 `W*H*3` —— 这是「花屏」的唯一原因。
- `worker_threads`，`N = max(1, availableParallelism() - 2)`；按**连续帧段**切分，worker 从自己的 `n0` 起跑、`prev = null`，**不要交错分配帧**。
- `concat` 用 `-c:v copy` 不重编码；**片长由帧数决定**（`-frames:v <总帧数>`），**绝不用 `-shortest`**（实测 4741 → 4739）。
- 混音用母版 `input/song.master.mp3`，不用原曲；交付片带 BT.709 标记（护栏会查）。

**工具脚本**：sha256 用 `node:crypto`，不要自己实现；「生成物 + sha256」的组合要能在**另一台机器**上复现，不能复现的要在文档里明说。

## 8. 验证护栏（改完必须跑）

`node film/guard.js` 会把 `AGENTS.md` §8 的全表跑一遍（快档 = 静态检查 + 48 帧真渲 + 截图侧冒烟），三条 ⭐ 在最前：

| 检查 | 做法 |
|---|---|
| ⭐ 帧数对账 | 各段区间求和 == `round(END_T * FPS)`（24 fps 下 4741），文件名编号连续无空洞 |
| ⭐ 同帧双渲比对 | 同一 `n` 渲两次逐字节比较；不等则打印差异区域坐标与首个差异像素 |
| ⭐ 时间线断言 | 段表按时间排序、首尾相接、无空洞无重叠、覆盖 `[0, END_T]`；画面轴与声音轴各查一次 |
| 素材两步校验 | `node film/check.js` 退出 0（或 `trim-song.mjs check`） |
| 成片帧数 | `ffprobe -count_frames` == 期望总帧数 |
| 无空白帧 | 抽样像素标准差，纯色帧报警 |
| 禁止随机 / 无猴补丁 / 依赖精确锁 | 全仓扫描（注释与测试名不算） |
| 仓库卫生 | 构建产物全被忽略、没有未跟踪产物 |
| 帧哈希清单 | `out/frames.sha256`：同机重渲必须逐行相同；**跨机器允许不同，但必须显式比对并报告差异帧数** |
| 边界帧抽查 | 出图供人眼过一遍（机器只能证明文件在） |

**尚未做的事如实说**：不写「已验证音画同步」「已保证确定性」这种话。
`--full` 的 4741 帧整片**没跑过**（快档只渲 48 帧）；确定性只在**同机、跨进程、跨 worker 数**下验证过，**跨机器没有验证**
（Skia 在不同 CPU 上可能走不同 SIMD 路径）；目前**没有任何 PV 画面的视觉验收** —— 引子的网页层已经能渲出 419 帧，但图形侧登记的仍是管线自检画面。

## 9. 许可与署名

- **代码**：MIT —— 见 [LICENSE.txt](LICENSE.txt)（Copyright (c) 2026-Present Pen-NineCat）。
- **参考代码** `world-execute-me-dsh-pv`：MIT，Copyright (c) 2026 MisakaZentai（技术路线与图形算子来源）。
- **vendored 的 dsh 素材**（`film/vendor/`）：MIT，Copyright (c) 2026 DeepSeek；三个包副本各带 `LICENSE`，
  字体按分发的 OFL 条款；`dsh-css/` 是我们抽出的快照（内容同属 dsh）。细节见 `film/vendor/README.md`。
- **vendored 的 `tools/lyrict/`**：MIT，版权归上游 Malte（`AverageHoarder/lyrict`）；**当前不可运行**（见 §4），
  这是仓库里唯一一份别人写的**代码**，改动请只做必要的 bug 修复并记账。
- **音乐与歌词**：**不随仓库分发，不授予再许可**；`Resource/song.json` 只是指纹，母版只在本地。
- 本片是非官方同人作品，与 DeepSeek、曲作者无隶属或认可关系；发布成片时按平台要求标注 AI 生成内容（若用到）。
- 参考项目的第三方资产（字体 OFL、鲸鱼娘立绘 CC BY-NC-SA 4.0）**不要顺手复制过来**。

## 10. 文档维护

- 改了行为就同时改 `README.md`（面向人）与这份 `AGENTS.md`（面向代理）；两者冲突时**以 `AGENTS.md` 为准**。
- 未定的条目一律加 `🚧`；定下来之后**同时**去掉标记并写清结论。**定了但没实现**的，要写清"已定、未实现"。
- `PersonalWorkaround/` 的三份长文不是仓库文档，引用时写清「本地文件，不提交」：
  施工说明是**工具链与阶段计划**的来源（它的附录 C 是施工记录，每完成一步就回填）；
  画面规格是**画面**的来源（现行结论 + ⛔ 待拍板项）。
- 素材事实（§3）与常量（`clock.js`）改动后，要同步 `Resource/song.json` 与两处正文里的数字。
