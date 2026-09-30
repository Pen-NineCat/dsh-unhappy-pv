# dsh-unhappy-pv

一支**逐帧用代码生成**的非官方同人 PV —— 目标曲目《69岁牢二次元 - unhappy（69岁牢二次元 remix）》。

🚧 **整体画面概念还没拍板，下面三条只是参考方向，不要当成结论。**
参考项目 `world-execute-me-dsh-pv` 的做法是左右分屏：

- 🚧 **左半**：DeepSeek Harness（dsh）的聊天窗口，她和「你」的对话。每帧生成 HTML、复用 dsh 自己的 CSS，用 Playwright 确定性截图。
- 🚧 **右半**：运行着她的那个「世界」，也就是模型的可视化。纯 PIL 逐帧绘制的 TUI 引擎 —— **「她」长什么样也还没定**。
- 🚧 **合成**：网页截图当成图形侧的一个图层，镜头运动、后期、编码全部由图形侧统一掌管。

画面全部是歌曲时间 `t` 的纯函数：不用剪辑软件，没有手工关键帧。

> **状态：骨架 + 指纹 + 一个修剪工具。** 仓库里目前有 `pyproject.toml`、`LICENSE.txt`、`Resource/`（歌曲指纹）、
> `tools/trim_song.py`（删掉音频尾部的小数帧）。**出片代码还没开始写**，下面带「计划中」字样的命令都还不存在。
> 灵感与技术路线来自参考项目 [`world-execute-me-dsh-pv`](https://github.com/Misakazentai/world-execute-me-dsh-pv)（本地副本在 `PersonalWorkaround/`，不提交）。

## 素材与版权：仓库里有什么、没有什么

这首歌受版权保护，**仓库里只有它的指纹**。

| 东西 | 在仓库里？ | 说明 |
|---|---|---|
| 歌曲音频（原曲） | ❌ | 只在本机。`Resource/song.json` 存它的 sha256 |
| 歌曲音频（母版，见下） | ❌ | 由 `tools/trim_song.py` 在本机生成，同样只留 sha256 |
| 歌词原文 | ❌ | 如需逐词时间轴，本机自备 LRC（计划） |
| 内嵌封面 | ❌ | 原件 ID3v2.3 里自带约 2 MB 封面；不随仓库分发 |
| 指纹与修剪工具 | ✅ | `Resource/song.json`、`tools/trim_song.py` |
| 代码 | ✅ | MIT（[LICENSE.txt](LICENSE.txt)） |
| 参考项目的字体 / dsh 前端 / 立绘 | ❌ | 各有许可条件，复制前先确认，不要顺手搬进来 |

## 音频：为什么要两个 sha256

片子按 24 fps 逐帧渲染，帧号 `n = round(t*FPS)` 是唯一主键，所以音频长度应当是**整数个视频帧**。
原曲 197.568 s 在 24 fps 下是 **4741.632** 帧，尾部多出 0.632 帧 —— 直接拿它出片，末帧会差一帧。

所以先用 `tools/trim_song.py` 生成**母版**：按 MPEG 帧边界做**字节级截断**（不重编码，纯标准库），
保留能盖住 4741 个视频帧的最少帧数。不重编码意味着 sha256 与机器、ffmpeg 版本无关，母版就是原曲的**字节前缀**。

| | 原曲（发行版） | 母版（成片所对齐） |
|---|---|---|
| sha256 | `2dcc4522772161d4fc747903217f3d2730b5d1335fb8b1b8c3615e915c343a2c` | `d60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8` |
| 时长 | 197.568 s | 197.544 s |
| MPEG 帧 / 字节 | 8232 / 9,972,236 | 8231 / 9,971,148 |
| 覆盖的视频帧 @24 fps | 4741.632 → 取 4741 | 4741（多 2.33 ms） |

```bash
python tools/trim_song.py make  --src input/song.mp3 --out input/song.master.mp3 --fps 24
python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3   # 两步校验
```

- **第 1 步（原曲 sha256）对不上只警告**：发行版可能有多种转码，仍能出片，但唱词与切点会漂移。
- **第 2 步（母版 sha256）对不上必须停下重做母版**：那意味着时间轴不可信。
- 时间零点 = 母版的第一个解码采样。片头静音多出或少掉一段，整片会平移，必要时先用 ffmpeg 裁齐。
- 已知怪癖（脚本会打印）：原件 Xing/Info 头 `frames=8231` 而 `bytes` 等于 8232 帧，头部自身差一帧；
  母版默认不改头部（以保住字节前缀性质），所以按字节估算长度的解码器会把母版报成 197.568 s，多 24 ms——不影响成片。
- 🚧 **帧率还没定**，而母版依赖 fps：fps 一改就得重新生成母版并更新指纹。

## 仓库结构

| 路径 | 内容 | 提交 |
|---|---|---|
| `Resource/` | `song.json`（两步指纹 + 参数 + 已知怪癖）、`README.md`（为什么这里没有原件） | ✅ |
| `tools/trim_song.py` | 生成 / 校验母版（纯标准库） | ✅ |
| `input/` | 本机输入：`song.mp3`、`song.master.mp3`、可选 `lyrics.lrc`；除 `README.md` 外全部忽略 | ❌ |
| `data/`、`film/`、`out/` | 时间轴清单 / 出片代码 / 产物 —— **计划中** | ✅ / ✅ / ❌ |
| `PersonalWorkaround/` | 个人/临时工作区：参考项目副本、mp3 原件、技术复盘长文 | ❌ |

目录名定下后**不要改名**：代码之间靠相对位置互相找到（参考项目的教训）。

## 快速开始

需要：Python 3.12+（本仓库用 **uv** 管环境）、Node 20+、ffmpeg 在 PATH 里。

```bash
uv sync                                    # 环境（当前 dependencies 为空）
python tools/trim_song.py make --src input/song.mp3 --out input/song.master.mp3 --fps 24

# 下面三段是计划中的流程，模块名待定，落地后请把这一段改成实测过的命令
python tools/check_song.py     # 环境与素材自检：两步 sha256、字体、ffmpeg
python -m film.pages           # 逐帧 HTML → Playwright 截图
python -m film.render          # 逐帧绘制 → 合成 → out/film.mp4
```

本机现状（2026-09-30）：git 仓库已初始化并推送（`origin` = `github.com/Pen-NineCat/dsh-unhappy-pv`，默认分支 `master`）；
`.venv` 由 uv 建，实测 **Python 3.14.7**；**ffmpeg/ffprobe 不在 PATH**，Playwright 未安装，`pillow`/`numpy` 还没加进依赖。动手前先补齐这几样。

## 技术要点

三条铁律，贯穿两个渲染器：

1. **帧号 `n = round(t * FPS)` 是唯一主键**：文件名、内存键、命令行参数共用，不对表。
2. **每一帧都是 `t` 的纯函数**：残影/运动模糊把上一帧作为**参数**传入，并行与「只重渲几帧」才成立。
3. **确定性优先于性能**：不确定的帧等于错的帧；慢可以并行，抖无法补救。

几个直接抄来的经验（细节见 [AGENTS.md](AGENTS.md)）：

- **Web 侧七个焊点**：等字体就绪、等图片 decode、用 Web Animations 把 CSS 动画钉在 `t` 上、相同 body 不重写 DOM、首帧多等、固定 viewport、资源全部本地。少一个，帧就会闪。
- **图形侧图层纪律**：背景 → 内容 → 载具 → **角色层（独立 RGBA）** → 框 → 后期。角色独立成层才能在合成器里推拉、滑出、隔离。
- **后期四件套**：残影用 `ImageChops.lighter`（`max`）而不是 `blend`、辉光 = 模糊后加回自己、扫描线与暗角必须 `lru_cache`、暗角在小图上算完再放大。
- **逐格延迟转场**：`reveal(old, new, t, delay)` 一个实现 + `radial` / `inward` / `sweep` 三个 `delay` 函数，覆盖十几个转场。
- **验证护栏**：帧数对账（本片 @24 fps 是 **4741** 帧）、同帧双渲逐像素比对、时间线断言。这三条能挡住绝大多数「渲完才发现某段是黑的」。

## 与参考项目的差异

| | `world-execute-me-dsh-pv` | 本项目 |
|---|---|---|
| 曲目 | Mili - world.execute(me);（211.913 s） | 69岁牢二次元 - unhappy（69岁牢二次元 remix）（197.568 s） |
| 帧率 / 尺寸 | 24 fps / 1280×720 | 🚧 未定（本文档里的 4741 帧、母版 sha256 都按 24 fps 算） |
| 音频处理 | 直接用歌曲（`data/song.json` 只记 sha256） | 先删尾部小数帧得到母版，原曲 + 母版**两步** sha256 |
| 素材策略 | 歌词只存时间不存文本、舞者用替身 | 沿用 sha256 门禁；歌词与角色方案 🚧 未定 |
| 「她」的形象 | 鲸鱼娘（CC BY-NC-SA 4.0） | 🚧 未定（不打算直接搬替身素材） |

## 许可

- **代码**：[MIT](LICENSE.txt) · Copyright (c) 2026-Present Pen-NineCat。
- **音乐与歌词**：不随仓库分发，本项目不授予任何再许可。
- **第三方资产**：参考项目里的字体（SIL OFL 1.1）、dsh 前端（MIT, DeepSeek）、鲸鱼娘立绘（CC BY-NC-SA 4.0）各有条件，复制前逐一确认。

## 署名与声明

- **音乐**：69岁牢二次元 - unhappy（69岁牢二次元 remix）
- **参考与灵感**：`world-execute-me-dsh-pv`（MisakaZentai）及其复盘文档；界面致敬 DeepSeek Harness（dsh）
- 本片是**非官方同人作品**，与 DeepSeek、曲作者没有从属或合作关系，也未经其认可。

协作者（尤其是 AI 代理）请先读 [AGENTS.md](AGENTS.md)：里面有硬规则、素材事实与验证护栏。
