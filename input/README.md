# input/：你自己准备的东西

歌曲受版权保护，不在本仓库里。构建时把文件放到这个文件夹；除本说明外，`input/` 全部被 `.gitignore` 忽略。

## 1. song.mp3（必需）—— 原曲

本机原件在临时工作区里：`PersonalWorkaround/69岁牢二次元 - unhappy（69岁牢二次元 remix）.mp3`。
拷进来（或做软链接）：

```powershell
Copy-Item "..\PersonalWorkaround\69岁牢二次元 - unhappy（69岁牢二次元 remix）.mp3" .\input\song.mp3
```

| 项目 | 值 |
|---|---|
| sha256 | `2dcc4522772161d4fc747903217f3d2730b5d1335fb8b1b8c3615e915c343a2c` |
| 时长 | 197.568 s（= 4741.632 帧 @24 fps，尾部有小数帧） |
| 格式 | MP3，CBR 320 kbps，48 kHz，立体声 |

## 2. song.master.mp3（必需）—— 母版

片子按整数个视频帧渲染，所以先把尾部的小数帧删掉：

```bash
node tools/trim-song.mjs make --src input/song.mp3 --out input/song.master.mp3 --fps 24
# 过渡期的 Python 版仍可跑（纯标准库，用系统解释器）：python tools/trim_song.py make ...
```

| 项目 | 值 |
|---|---|
| sha256 | `d60539b00745d926822d7e559d846c6610b827061b3695336bd1452014a3dbe8` |
| 时长 | 197.544 s（= 8231 MPEG 帧，盖住 4741 个视频帧，多 2.33 ms） |
| 做法 | 按 MPEG 帧边界做字节级截断，不重编码；母版 == 原曲的前 9,971,148 字节 |

母版同样**不进仓库**。两份的 sha256 与参数记录在 [`../Resource/song.json`](../Resource/song.json)，
每次出片前跑一次两步校验：

```bash
node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3
```

- 第 1 步（原曲）对不上只警告；第 2 步（母版）对不上必须停下来重做，别出片。
- 时间零点 = 母版第一个解码采样。片头静音多出或少掉一段，唱词与镜头会整体推后或提前；必要时先用 ffmpeg 裁齐。
- 帧率已锁 **24 fps**（母版与 sha256 按它算）。真要改 fps，母版必须重新生成、sha256 也会变。

## song.lrc（可选）

本机已经有一份 `input/song.lrc`（`.gitignore` 忽略 `*.lrc`，歌词文本不随仓库分发）。
逐词时间轴要不要用、用哪个版本仍是 🚧；`tools/lyrict/` 那个 vendored 歌词工具**当前不可运行**
（它是 Python 包，本仓库已移除 Python 环境），需要时自建临时 venv。
