# AGENTS.md

> 给在本仓库里干活的 AI 代理（以及未来的协作者）的约定。
> 面向人的介绍在 [README.md](README.md)；技术路线的长文在 `PersonalWorkaround/dsh-wme-pv-review.md`（本地文件，不提交）。

**标记约定**：`🚧` = **未定 / 条目不完整**。带这个标记的内容只是占位与方向，**不要当成依据**，也不要据此写死代码。
目前 🚧 的条目：整体画面概念、帧率与分辨率、「她」的形象、歌词方案（要不要逐词时间轴、用哪个版本）。（如果你看到别的图标，那就是同一个意思。）

## 1. 项目是什么

`dsh-unhappy-pv`：为《69岁牢二次元 - unhappy（69岁牢二次元 remix）》做一支**逐帧用代码生成**的非官方同人 PV。

🚧 **画面概念：未拍板，本节不完整。** 参考方向是照搬 `world-execute-me-dsh-pv` 的分屏：

- 🚧 **左半**：DeepSeek Harness（dsh）的聊天窗口 —— 逐帧生成 HTML、复用 dsh 自己的 CSS，Playwright 确定性截图；
- 🚧 **右半**：运行着她的那个「世界」—— 纯 PIL 逐帧绘制的 TUI 引擎；**「她」的形象还没定**（原创立绘 / 纯几何 / 别的）；
- 🚧 **合成**：把网页截图当成图形侧的一个图层，统一做镜头运动、后期与编码。

**已经确定的**：非官方同人、逐帧用代码生成、目标曲目是上面那一首、素材策略见 §3。

**现状**：仓库只有骨架 + 指纹 + 一个修剪工具。渲染代码一行都没写，所以 §5 里除 `trim_song.py` 之外的命令都是**计划中的接口**。
接口一旦落地，请立刻回来改这份文件——它宁可短，也不要写不存在的命令。

## 2. 硬规则（不要违反）

1. **音频原件永远不进仓库。** 仓库只存 sha256（`Resource/song.json`）：原曲一个、母版一个，两步校验见 §3。
   `.gitignore` 里有 `*.mp3`/`*.wav` 保险丝，确需提交音频得先说明理由。
2. **`PersonalWorkaround/` 整个目录都不提交。** 它是个人 + 临时工作区：参考项目完整副本、mp3 原件、复盘长文都在里面。
   其中的 `world-execute-me-dsh-pv/` **自带 `.git`** —— 只读参考，不要改它的任何文件，也不要把它 `git add` 进来（会变成嵌套仓库）。
3. **`Resource/` 只放指纹与说明**，不放音频、视频、图片原件。
4. **不要 `git add -A` / `git add .`。** 显式列文件；提交前 `git status` 必须是干净的。
5. **帧号是唯一主键**：`n = round(t * FPS)`。文件名、内存键、命令行参数、缓存键全用它，不要引入第二套编号。
6. **每一帧都是 `t` 的纯函数。** 跨帧状态（残影、上一帧）必须作为**参数**传入，不能藏在全局变量里。
7. **随机必须按帧播种**：`random.Random(seed * 9973 + n)`。禁止模块级 `random`。
8. **所有产物进 `.gitignore`**（`out/`、帧目录、`*_frames.json`、`segments/`、`node_modules/`、`__pycache__/`）。
   凡是被忽略的，都必须能用一条命令重建。
9. **参考项目的第三方资产不要复制进本仓库**：字体（OFL）、dsh 前端（MIT）、鲸鱼娘立绘（CC BY-NC-SA 4.0）各有许可条件，复制前先确认。
10. **改帧率（🚧 待定项）时，母版必须重新生成**：`Resource/song.json` 里的 `master` 依赖 fps，改了 fps 就要重跑 `tools/trim_song.py` 并更新指纹。

## 3. 素材事实（改代码前先读这一节）

目标曲目：**69岁牢二次元 - unhappy（69岁牢二次元 remix）**（专辑 `[三分钟]Unhappy`）。
以下全部由本机原件实测（2026-09-30，解析 MPEG 帧头 + ID3v2 标签，**本机没有 ffprobe**）：

| | 原曲（发行版） | 母版（成片所对齐） |
|---|---|---|
| sha256 | `2dcc4522…c343a2c` | `d60539b0…4a3dbe8` |
| 时长 | 197.568 s | 197.544 s |
| MPEG 帧 | 8232 | 8231 |
| 字节 | 9,972,236 | 9,971,148（原曲的前缀） |
| 整数视频帧 @24 fps | 4741.632 → 取 4741 | 4741（多出 2.33 ms） |

- 其余参数：MP3 CBR 320 kbps、48 kHz、立体声、1152 采样/帧、960 字节/帧；ID3v2.3（内嵌约 2 MB 封面）、结尾 128 字节 ID3v1。
- **两步校验**（`python tools/trim_song.py check`）：
  1. **原曲** sha256 对不上 → **只警告**（可能仍能出片，但唱词与切点会漂移）；
  2. **母版** sha256 对不上 → **停下重做母版**，时间轴不可信。
- **母版怎么来的**：`tools/trim_song.py` 按 MPEG 帧边界做**字节级截断**（不重编码），所以 sha256 与机器、ffmpeg 版本无关；
  母版就是原曲的**字节前缀**，这条性质可以手工复核（截到第 9,971,148 字节）。
- **时间零点 = 母版的第一个解码采样**（与参考项目同一约定）。片头静音长短不一致会让整片平移。
- **已知怪癖**：原件 Xing/Info 头 `frames=8231` 而 `bytes=7902720`（= 8232 帧），头部自身差一帧；母版默认不改头部，
  于是按字节估算长度的解码器会把母版报成 197.568 s（多 24 ms，不影响 `-shortest` 下的成片）。
  要头部自洽用 `--patch-info`，但那会得到另一个 sha256（`f119cfba…`）——**两者只能选一个并固定在 `Resource/song.json`**。
- 🚧 **未核实**：时长未用 ffprobe 复核；解码器延迟/补齐（约 1105 采样）未核实，本工具只保证 MPEG 帧层对齐。

## 4. 目录约定（部分为计划）

| 路径 | 内容 | 提交 |
|---|---|---|
| `Resource/` | `song.json`（两步 sha256 + 参数 + 已知怪癖）、`README.md`（为什么没有原件） | ✅ |
| `tools/` | `trim_song.py`（已落地）；以后放 `check_song.py`、`lyrics.py` 之类 | ✅ |
| `input/` | 本机输入：`song.mp3`、`song.master.mp3`、可选 `lyrics.lrc`；除 `README.md` 外全部忽略 | ❌ |
| `data/` | 不含文字的逐词时间轴等小体积清单（计划） | ✅ |
| `film/` | 出片代码：左侧页面脚本 + 截图器、右侧 PIL 引擎、合成器（计划） | ✅ |
| `out/` | 成片与中间产物（计划） | ❌ |
| `PersonalWorkaround/` | 个人/临时工作区：参考项目副本、mp3 原件、复盘长文 | ❌ |

目录名一旦定下就**不要改名**（参考项目的教训：代码之间靠相对位置互相找到）。

## 5. 命令

**已落地**（可以直接跑）：

```bash
# 生成母版（本机跑一次）+ 两步校验（每次出片前跑）
python tools/trim_song.py make  --src input/song.mp3 --out input/song.master.mp3 --fps 24
python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3
```

`check` 的退出码：0 通过（原曲不匹配只是警告）；1 母版不匹配或不再是原曲的前缀；2 用法错误。

**计划中**（模块名待定，落地后请删掉本段说明）：

```bash
python tools/check_song.py     # 环境与素材自检：两步 sha256、字体、ffmpeg
python -m film.pages           # 逐帧 HTML → Playwright 截图
python -m film.render          # 逐帧绘制 → 合成 → out/film.mp4
```

只重渲某几帧（参考项目最实用的一个开关，务必保留）：

```bash
node shot.mjs frames.json 2769 2770 2800
```

## 6. 本机环境现状（2026-09-30 快照）

| 项 | 状态 |
|---|---|
| git | 分支 `master`；remote `origin` → `https://github.com/Pen-NineCat/dsh-unhappy-pv`（2026-09-30 建的空仓库，首次推送时 `master` 成为默认分支） |
| 环境管理 | **uv**（0.12.13）+ `uv.lock`；`.venv` 实测 **Python 3.14.7**（`requires-python = ">=3.12"`，uv 取了系统 3.14，不是 3.12） |
| 依赖 | `dependencies = []` —— **pillow / numpy 还没装**；系统另有 `C:\Python314\python.exe` |
| Node | 有（`E:\NodeJS`） |
| ffmpeg / ffprobe | **不在 PATH** —— 出片必需，动手前先装（也才能复核时长与 `known_quirks`） |
| Playwright | 未安装（需要 `npm install` + `npx playwright install chromium`） |
| 参考项目工作副本 | `PersonalWorkaround/world-execute-me-dsh-pv/`（自带 `.git`，1586 个已跟踪文件，勿动） |

新建/改动环境的命令一律用 `uv`（`uv sync`、`uv add <pkg>`），不要往 `.venv` 里手动 `pip install`。

## 7. 代码约定

**图形侧（PIL）**

- 单帧入口 `frame(n) -> Image`；要做残影/运动模糊就 `frame(n, prev=None)`，上一帧走参数。
- 固定图层顺序：背景 → 主体内容 → 载具层 → **角色层（独立 RGBA）** → 装饰与 UI 框 → 后期。
  角色必须是独立一层，否则推拉/滑出/隔离都做不了。
- 常量一律 `lru_cache`：字体对象、字形网格、扫描线、暗角、noise tile、背景。**`ImageFont.truetype()` 每次调用都读磁盘，必须缓存。**
- 小图算完再放大（暗角 64×36 → `BILINEAR`）；调色用 `point(LUT)` 而不是逐像素循环。
- 降采样用 `Image.BOX`，放大像素画用 `NEAREST`，缩放照片用 `LANCZOS`——用错就糊或出锯齿。
- 时间重叠/空洞用 `finalize()` 式断言兜住，不要靠人眼发现。

**Web 侧（Playwright）**

七个焊点，少一个帧就会随机闪烁：等 `document.fonts.ready` → 等 `img.decode()` → 用 Web Animations 把 CSS 动画 `pause()` 并按 `t` 设 `currentTime`（在 `innerHTML` **之后**设）→ 相同 body 不重写 DOM → 首帧多等 ~150 ms → 固定 viewport 与 `deviceScaleFactor` → 资源全部本地（`file://`，无 CDN、无系统 emoji）。

**编码侧（ffmpeg）**

喂管道前断言 `im.mode == "RGB" and im.size == (W, H)`；`im.tobytes()` 的顺序必须与 `-pix_fmt rgb24` 一致。
并行按**连续帧段**切分（每个 worker 从自己的 `n0` 起跑并把 `prev` 重置为 `None`），段内 `concat` 不重编码，最后混音 + `+faststart`。
混音时用母版（`input/song.master.mp3`），不要用原曲——尾部那 0.632 帧会让末尾差一帧。

**脚本侧（本仓库的工具）**

- 只依赖标准库、不依赖 ffmpeg 的最优先（`trim_song.py` 就是纯标准库），因为本机连 ffmpeg 都还没有。
- 任何「生成物 + sha256」的组合都要能在**另一台机器**上复现；不能复现的方案要在文档里明说。

## 8. 验证护栏（改完必须跑）

三条 ⭐ 是核心，能挡住「片子渲完才发现第 2000 帧是黑的」：

| 检查 | 做法 |
|---|---|
| ⭐ 帧数对账 | 各段区间求和 == 期望总帧数 `round(END_T * FPS)`（🚧 fps 定下后重算；按 24 fps 是 4741），文件名编号连续无空洞 |
| ⭐ 同帧双渲比对 | 同一 `n` 渲两次，`ImageChops.difference(a, b).getbbox()` 必须是 `None` |
| ⭐ 时间线断言 | 语段表按时间排序、首尾相接、无空洞无重叠，覆盖 `[0, END]` |
| 素材两步校验 | `python tools/trim_song.py check` 退出码 0 |
| 无空白帧 | 抽样 `ImageStat.stddev`，纯色帧（≈0）通常是注入失败 |
| 边界帧抽查 | 显式渲 `t=0`、末帧、每个转场的首末帧，人眼看一遍 |
| 仓库卫生 | `git status` 干净；构建跑完出现未跟踪文件 = `.gitignore` 漏了 |

**尚未做的事如实说**：不写「已验证音画同步」这种话。目前没有任何逐帧视觉验收；时长也还没用 ffprobe 复核。

## 9. 许可与署名

- **代码**：MIT —— 见 [LICENSE.txt](LICENSE.txt)（Copyright (c) 2026-Present Pen-NineCat）。
- **音乐与歌词**：**不随仓库分发，不授予再许可**；`Resource/song.json` 只是指纹，母版只在本地。
- 本片是非官方同人作品，与 DeepSeek、曲作者无隶属或认可关系；发布成片时按平台要求标注 AI 生成内容（若用到）。
- 参考项目的第三方资产（字体 OFL、dsh 前端 MIT、鲸鱼娘立绘 CC BY-NC-SA 4.0）**不要顺手复制过来**。

## 10. 文档维护

- 改了行为就同时改 `README.md`（面向人）与这份 `AGENTS.md`（面向代理）。
- 两者冲突时，**以 `AGENTS.md` 为准**：它是可执行的约定，README 是介绍。
- 未定的条目一律加 `🚧`；定下来之后**同时**去掉标记并写清结论，不要留下含糊的「大概」。
- `PersonalWorkaround/` 里的复盘长文不是仓库文档，引用它时请写清「本地文件，不提交」。
