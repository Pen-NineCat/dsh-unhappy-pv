# dsh-unhappy-pv

一支**逐帧用代码生成**的非官方同人 PV —— 目标曲目《69岁牢二次元 - unhappy（69岁牢二次元 remix）》。
画面全部是歌曲时间 `t` 的纯函数：不用剪辑软件，没有手工关键帧。

> **状态：出片管线已完成并验收；片子还没开始画。**
>
> - **管线**：纯 Node —— `@napi-rs/canvas`（Skia）+ Playwright + ffmpeg + `worker_threads`，Phase 0–7 全部落地。
>   本轮实测：`node film/check.js` 退出 0、`node film/test/run.js` **249/249**、`node film/guard.js` **14/14**（三条 ⭐ 护栏全过）。
> - **画面**：按仓库根的 **[`design-options.md`](design-options.md)（画面规格）** 逐段实现中 —— 引子 `[0,419)` 与第一幕 `[419,1903)` 已有画布侧实现
>   （`film/content/prelude.js`、`film/content/act1.js`，含 T4 的三格版面），网页层的引子页在 `film/pages/intro.js`。
>   **幕间与第二幕仍指向管线自检画面**（`content/example.js`）。分镜、任务清单（T0–T10）、验收标准与 ⛔ 待拍板项都在那份规格里。
> - **没做过的**：`--full`（4741 帧整片）没跑过（护栏快档只渲 48 帧验证链路）；**跨机器确定性没有验证**（只证明了同机、跨进程、跨 worker 数一致）；没有任何 PV 画面的视觉验收。
> - 灵感与技术路线来自参考项目 [`world-execute-me-dsh-pv`](https://github.com/Misakazentai/world-execute-me-dsh-pv)（本地副本在 `PersonalWorkaround/`，不提交）。

## 素材与版权：仓库里有什么、没有什么

这首歌受版权保护，**仓库里只有它的指纹**。

| 东西 | 在仓库里？ | 说明 |
|---|---|---|
| 歌曲音频（原曲） | ❌ | 只在本机。`Resource/song.json` 存它的 sha256 |
| 歌曲音频（母版，见下） | ❌ | 由 `tools/trim-song.mjs` 在本机生成，同样只留 sha256 |
| 歌词原文 | ❌ | `input/song.lrc` 已在本机（`*.lrc` 被忽略）；文本不随仓库分发 |
| 内嵌封面 | ❌ | 原件 ID3v2.3 里自带约 2 MB 封面；不随仓库分发 |
| 指纹 | ✅ | `Resource/song.json` + `Resource/README.md` |
| dsh 界面素材 | ✅ | `film/vendor/`：`dsh-web-frontend`、`dsh-client-ui-theme`、`dsh-client-ui-cordis`（各 `0.1.7-rc.2`，MIT，DeepSeek）与**抽取出来的** `dsh-css/` |
| 代码 | ✅ | MIT（[LICENSE.txt](LICENSE.txt)） |
| 参考项目的立绘 / 字体 | ❌ | 各有许可条件，复制前先确认，不要顺手搬进来 |

## 音频：为什么要两个 sha256

片子逐帧渲染，帧号 `n = round(t*FPS)` 是唯一主键，所以音频长度应当是**整数个视频帧**。
原曲 197.568 s 在 24 fps 下是 **4741.632** 帧，尾部多出 0.632 帧 —— 直接拿它出片，末帧会差一帧。

所以先生成**母版**：按 MPEG 帧边界做**字节级截断**（不重编码），保留能盖住整数个视频帧的最少帧数。
不重编码意味着 sha256 与机器、ffmpeg 版本无关，母版就是原曲的**字节前缀**。

| | 原曲（发行版） | 母版（成片所对齐） |
|---|---|---|
| sha256 | `2dcc4522772161d4fc747903217f3d2730b5d1335fb8b1b8c3615e915c343a2c` | `d60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8` |
| 时长 | 197.568 s | 197.544 s |
| MPEG 帧 / 字节 | 8232 / 9,972,236 | 8231 / 9,971,148 |
| 覆盖的视频帧 @24 fps | 4741.632 → 取 4741 | 4741（多 2.33 ms） |

```bash
node tools/trim-song.mjs make  --src input/song.mp3 --out input/song.master.mp3 --fps 24
node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3   # 两步校验

node tools/trim-song-parity.mjs   # 与过渡期的 Python 版逐字节对拍（需要系统 Python 在场）
```

- **第 1 步（原曲 sha256）对不上只警告**：发行版可能有多种转码，仍能出片，但唱词与切点会漂移。
- **第 2 步（母版 sha256）对不上必须停下重做母版**：那意味着时间轴不可信。
- 时间零点 = 母版的第一个解码采样。片头静音多出或少掉一段，整片会平移，必要时先用 ffmpeg 裁齐。
- 已知怪癖（脚本会打印）：原件 Xing/Info 头 `frames=8231` 而 `bytes` 等于 8232 帧，头部自身差一帧；
  母版默认不改头部（以保住字节前缀性质），于是 **ffprobe 给原曲和母版报的时长都是 197.504 s**（读头部，分不出这两份文件）。
- **别用 `-shortest` 定片长**：实测它会按 197.504 s 切，把 4741 帧的成片变成 **4739 帧**；
  片长由帧数决定（`-frames:v 4741` 或 `-t round(END_T*FPS)/FPS`），渲染器已经这么做。
- 帧率已锁 **24 fps / 1920×1080 原生**。真要改 fps，母版必须重新生成、指纹必须更新。
- `tools/trim_song.py` 是**过渡件**（纯标准库，用系统解释器），Node 版接替后由作者决定是否删除。

## 仓库结构

| 路径 | 内容 |
|---|---|
| [`design-options.md`](design-options.md) | **画面规格**（仓库根，随代码提交）：现行结论、任务清单 T0–T10、验收标准、⛔ 待拍板项——它就是给管线 Agent 的施工输入 |
| `film/kit/` | 图形原语：画布与图层、位图算子（LUT / box 降采样 / 可分离高斯 / Sobel）、字形图集与文本、调色、噪声、后期 |
| `film/engine/` | `clock.js`（常量唯一来源）、`timeline.js`（段表 + 断言）、`layers.js`（六层顺序）、`content.js`（**内容的唯一注册点**）、`frame.js`（`frame(n, prev)`）、`camera.js`、`transitions.js` |
| `film/content/` | 图形侧场景：`prelude.js`（引子：占位背景 + 三格骨架）、`act1.js`（第一幕）、`panels.js`、`cursor.js`、`memory.js`；`example.js` 是管线自检画面（**幕间与第二幕仍用它**） |
| `film/pages/` | 网页层：**`intro.js`（引子的真页面，帧 0–419）**、`body.js`（`body(t) -> HTML`，`intro` / `probe` 两个变体）、`gen-frames.js`（→ frames.json + 舞台）、`shot.mjs`（Playwright 截图器）、`preview.mjs`（全览表 + 预览片）、`extract-css.mjs`（抽 dsh CSS → `vendor/dsh-css/`）、`dsh-*.js` |
| `film/compose/` | 把网页截图当图层接进图形侧：`overlay.js`、`lead.js`（主导权）、`shots.js`（缺帧报错）、`track-layer.js` |
| `film/lib/` | `ffmpeg-path.js`（三级路径解析）、`frame-segments.js`、`render-worker.js`、`static-server.js` |
| `film/{check,guard,hash,render,render-video}.js` | 自检、全量护栏、帧哈希清单、单帧渲染、分段渲染 + 编码 |
| `film/test/` | 测试与探针：`run.js`（测试入口）与各套件、`perf-baseline.js`、若干一次性 probe |
| `film/vendor/` | dsh 的 MIT 素材：三个包副本 + 抽取出来的 `dsh-css/`（见该目录的 README） |
| `tools/trim-song.mjs`、`trim-song-parity.mjs` | 母版修剪（Node）与两版对拍 |
| `Resource/`、`input/` | 指纹 / 本机输入（音频、歌词；除 `README.md` 外全部忽略） |
| `data/` | 由脚本生成的小清单：`cursor/keypoints.json`（鼠标路径的关键点表） |
| `out/` | 产物：帧、预览、成片、护栏报告 |

目录名定下后**不要改名**：代码之间靠相对位置互相找到（参考项目的教训）。

## 快速开始

需要 **Node 20+**（本机 24.x）与 **ffmpeg 在 PATH 里**。PowerShell 下 `npm` / `npx` 要用 `.cmd`（执行策略禁用了 `.ps1`）。

```bash
npm.cmd install && npx.cmd playwright install chromium

npm.cmd run check      # 环境与素材自检：ffmpeg 路径、两步 sha256、Playwright、vendor sha256（退出码 0/1/2）
npm.cmd test           # 测试套件
npm.cmd run guard      # 全量护栏（快档：静态检查 + 48 帧真渲）；guard:full 才是 4741 帧
npm.cmd run trim -- check --src input/song.mp3 --master input/song.master.mp3
```

**看一眼画面**（引子那 419 帧）：

```bash
npm.cmd run prelude    # gen-frames 0–419 → shot 截图 → preview 出全览表与预览片
npm.cmd run preview -- --range 0 419        # 也可以单独重出预览
npm.cmd run smoke                           # 10 帧冒烟：只验"同一 n 渲两次逐像素一致"
```

产物在 `out/prelude/`（PNG + `shots.json`）与 `out/preview/`（`sheet-*.png` 全览表、`preview-*.mp4` 预览片、逐帧变化表）。
预览片是**有损编码、只为看得见**，不是成片管线。

**出片**：

```bash
npm.cmd run render                          # 分段渲染 + concat + 混音 → out/film.mp4
npm.cmd run render -- --range 100 200       # 只渲一段
npm.cmd run render -- --frames 2769,2770,2800
npm.cmd run master                          # 无损母版 out/film.master.mkv + 交付转码
npm.cmd run all                             # check + test + pages + render
```

`film/render-video.js --manifest` 会另出 `out/frames.sha256`（每帧一行），用于跨机器比对。

## 护栏与验证到哪一步

| 命令 | 覆盖 |
|---|---|
| `node film/check.js` | 素材两步 sha256 + 母版字节前缀、ffmpeg/ffprobe 实际路径、Playwright 浏览器、vendor 四个文件的 sha256 |
| `node film/test/run.js` | 单元与集成测试（时间线断言、图形算子对拍、图层与后期、截图侧、合成、渲染护栏） |
| `node film/guard.js` | `AGENTS.md` §8 的全表：三条 ⭐（帧数对账 / 同帧双渲 / 时间线断言）+ 成片帧数、空白帧、禁止随机、无猴补丁、依赖精确锁、仓库卫生、BT.709 标记等 |

**诚实边界**：护栏默认是快档（静态检查 + 48 帧真渲），`--full` 的 4741 帧整片**没跑过**；
确定性只在**同机、跨进程、跨 worker 数**下验证过，**跨机器没有验证**（Skia 在不同 CPU 上可能走不同 SIMD 路径）；
边界帧抽查会出图，但"需要人眼看一遍"这件事机器只能提醒，不能代替。

## 关于歌词 `.lrc`

`input/song.lrc` 已经在本机（`.gitignore` 忽略 `*.lrc`，歌词文本不随仓库分发）。
`tools/lyrict/`（vendored 上游，MIT）是导出/写入歌词标签的工具，但它现在是 Python 包，
**本仓库已移除 Python 环境**，要跑得自己临时建一个 venv 装 `mutagen` + `tqdm`。
它不阻塞出片；逐词时间轴（要不要、用哪个版本）仍然未定，`data/timing/` 也还没落地。

## 技术要点

三条铁律，贯穿两个渲染器：

1. **帧号 `n = round(t * FPS)` 是唯一主键**：文件名、内存键、命令行参数共用，不对表。
2. **每一帧都是 `t` 的纯函数**：残影/运动模糊把上一帧作为**参数**传入，并行与「只重渲几帧」才成立。
3. **确定性优先于性能**：不确定的帧等于错的帧；慢可以并行，抖无法补救。

几个关键约束（细节见 [AGENTS.md](AGENTS.md)）：

- **段区间半开 `[start, end)`**，边界帧归后一段；**画面轴与声音轴是两张独立的段表**，各自半开、各自无重叠。
- **Web 侧七个焊点**：等字体就绪、等图片 decode、用 Web Animations 把 CSS 动画钉在 `t` 上、相同 body 不重写 DOM、首帧多等、固定 viewport、资源全部本地。少一个，帧就会闪。
- **图形侧六层**：背景 → 内容 → 载具 → **角色层（独立画布）** → 框 → 后期。角色独立成层，才能对它做推拉、滑出、隔离。
- **后期四件套**：残影用 `max`（`globalCompositeOperation='lighten'`）而不是 `blend`、辉光 = 模糊后加回自己、扫描线与暗角要缓存、暗角在小图上算完再放大。
- **逐格延迟转场**：`reveal(old, new, t, delay)` 一个实现 + `radial` / `inward` / `sweep` / `dissolve` 四个 `delay`。
- **没有 `Image.BOX` 等价物**：降采样到字符网格必须手写区域平均，别用 `drawImage` 缩小去凑。
- **全片无声**（只有歌声），因此一帧硬切就是最大音量；同一时刻在场通道 ≤ 3。

## 与参考项目的差异

| | `world-execute-me-dsh-pv` | 本项目 |
|---|---|---|
| 曲目 | Mili - world.execute(me);（211.913 s） | 69岁牢二次元 - unhappy（69岁牢二次元 remix）（197.568 s） |
| 语言 / 运行时 | Python 3 + Pillow + NumPy，GPU 后期走 torch | **纯 Node.js**：`@napi-rs/canvas`（Skia）+ `worker_threads`，v1 不做 GPU |
| 帧率 / 尺寸 | 24 fps / 1280×720 | **24 fps / 1920×1080 原生** |
| 音频处理 | 直接用歌曲（只记 sha256） | 先删尾部小数帧得到母版，原曲 + 母版**两步** sha256 |
| 架构 | 内存猴补丁替换宿主函数 | 显式接口：`content.js` 是唯一注册点，`compose/track-layer.js` 用注入而非改写 |
| 界面素材 | 抽取组件 CSS 提交 | 三个 MIT 包副本 + 抽取出的 `dsh-css/` 快照（另一台机器不需要装 dsh 也能构建网页层） |
| 素材策略 | 歌词只存时间不存文本、舞者用替身 | 沿用 sha256 门禁；歌词与结尾方案仍未定 |

## 许可

- **代码**：[MIT](LICENSE.txt) · Copyright (c) 2026-Present Pen-NineCat。
- **参考代码** `world-execute-me-dsh-pv`：[MIT](https://github.com/MisakaZentai/world-execute-me-dsh-pv/blob/main/LICENSE) · Copyright (c) 2026 MisakaZentai。
- **vendored 的 dsh 素材**（`film/vendor/`）：[MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) · Copyright (c) 2026 DeepSeek；
  三个包副本各自带 `LICENSE`，字体按分发的 OFL 条款（`dsh-web-frontend/assets/fonts/Montserrat-OFL.txt`）。
  `dsh-css/` 是我们抽出来的快照，内容同属 dsh。
- **vendored 的 `tools/lyrict/`**：MIT，版权归上游 `AverageHoarder/lyrict`。
- **音乐与歌词**：不随仓库分发，本项目不授予任何再许可。

## 署名，致谢与声明

- **音乐**：69岁牢二次元 - unhappy（69岁牢二次元 remix）

  [[AI扩写]嫌一分半的Unhappy太短？AI扩写到三分半的听个爽！](https://www.bilibili.com/video/BV193dZBxE93/)

  由衷感谢「69岁牢二次元」大佬提供该 remix 的曲子。

- **参考与灵感**：[`world-execute-me-dsh-pv`](https://github.com/Misakazentai/world-execute-me-dsh-pv)（MisakaZentai）及其复盘文档；界面致敬 DeepSeek Harness（dsh）。

  由衷感谢「MisakaZentai」大佬提供的灵感与图形算子。

- 本片是**非官方同人作品**，与 DeepSeek、曲作者没有从属或合作关系，也未经其认可。

协作者（尤其是 AI 代理）请先读 [AGENTS.md](AGENTS.md)：里面有硬规则、素材事实与验证护栏。
