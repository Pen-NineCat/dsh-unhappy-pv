# Resource/：只放指纹，不放原件

这个目录里**没有音频文件**，而且不应该有。

《unhappy（69岁牢二次元 remix）》受版权保护，不随本仓库分发。这里放的是**指纹**：`song.json` 记录
原件的 sha256、以及**母版**的 sha256。出片脚本按这两步核对。

| 东西 | 在仓库里 | 作用 |
|---|---|---|
| 原曲（发行版原件） | ❌ 只在本机 | 第 1 步：确认你手上是哪一份 |
| 母版（删掉尾部小数帧的版本） | ❌ 只在本机 | 第 2 步：成片所对齐的那一份 |
| 两份的 sha256 与参数 | ✅ `song.json` | 两步校验的依据 |

## 为什么有两个 sha256

1. **原曲**：发行版音频可能有多种转码。第 1 步先认人；对不上**只警告**（还能出片，但唱词与切点会漂移）。
2. **母版**：片子逐帧渲染，音频长度必须是整数个视频帧。原曲 197.568 s = 4741.632 帧（24 fps），
   尾部多出 0.632 帧，用修剪工具按 MPEG 帧边界做**字节级截断**（不重编码）得到母版。
   第 2 步对不上就**必须停下来重做母版**——那意味着时间轴不可信。

```bash
# 现行：Node 版（与过渡期的 Python 版逐字节对拍过）
node tools/trim-song.mjs make  --src input/song.mp3 --out input/song.master.mp3 --fps 24
node tools/trim-song.mjs check --src input/song.mp3 --master input/song.master.mp3

# 过渡期：Python 版仍可跑（纯标准库，用系统解释器）；等作者拍板后删除
python tools/trim_song.py check --src input/song.mp3 --master input/song.master.mp3
```

母版有一个很好复核的性质：**它就是原曲的字节前缀**。

```powershell
Get-FileHash -Algorithm SHA256 "<原曲>"
Get-FileHash -Algorithm SHA256 "<母版>"
```

`master.invariant` 字段里写着要截到第几字节；用 Node 一行也能验：
`crypto.createHash('sha256').update(orig.subarray(0, 9971148)).digest('hex')` 应当等于母版的 sha256。

## 已知的头部怪癖（`known_quirks`）

原件的 Xing/Info 头里 `frames=8231`，但 `bytes=7902720` 是 8232 帧的字节数——**原件头部自己差一帧**。
母版默认不改头部（以保住「字节前缀」这条性质），于是**任何读头部的工具都会把这两份文件报成同一个长度**：
实测 ffprobe 对原曲和母版都报 `197.504` s。

**由此有一个实测陷阱**：`-shortest` 会按 197.504 s 切断视频，**4741 帧的成片会变成 4739 帧**。
片长必须由帧数决定（`-t round(END_T*FPS)/FPS` 或 `-frames:v <总帧数>`）。
要头部自洽就用 `--patch-info`，但那会得到另一个 sha256，**两种只能选一种并固定记录在 `song.json` 里**。

## 什么不该放进这里

音频、视频、封面图片、任何从原件里抽出来的素材——无论体积多小。要放图片请先确认授权。
