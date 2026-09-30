#!/usr/bin/env python3
"""trim_song.py — 把原曲尾部的「小数帧」删掉，得到成片所对齐的母版。

片子按 24 fps 逐帧渲染，帧号 n = round(t*FPS) 是唯一主键，所以音频长度应当是整数个视频帧。
原曲 197.568 s 在 24 fps 下是 4741.632 帧 —— 尾部多出 0.632 帧。

做法：**字节级截断，不重编码**。MP3 帧长固定（48 kHz、1152 采样/帧、320 kbps → 960 字节/帧），
保留 ID3v2 标签 + 前 k 个 MPEG 帧、丢掉其余字节即可。不重编码的收益是：同一份原曲在任何机器、
任何 ffmpeg 版本下都得到同一个 sha256 —— 这是「两步校验」能成立的前提。
代价是母版仍然是原文件的**字节前缀**（这条性质本身也可以用来手工复核）：

    sha256(原曲前 N 字节) == 母版的 sha256

k 的取法：让音频**盖住**整数个视频帧。取满足 k*spf/sr >= floor(dur*FPS)/FPS 的最小 k
（向下取整后再补一帧），音频最多比视频长一个 MP3 帧（24 ms）。宁可多不能少：
音频短于视频时 `-shortest` 会把最后几个视频帧一起切掉。

已知的原件怪癖（本工具会打印出来）：这个文件的 Xing/Info 头里 `frames` 字段是 8231，
而 `bytes` 字段等于 8232 帧的字节数 —— 两个字段自身差一帧。默认**不动头部**（保持字节前缀性质），
需要把头部改成自洽的可以用 `--patch-info`（会改变 sha256，二者只能选一个并固定在 Resource/song.json）。

用法：

    # 生成母版，并打印可直接粘进 Resource/song.json 的 JSON
    python tools/trim_song.py make --src <原曲.mp3> --out <母版.mp3> --fps 24

    # 两步校验：1) 原曲 sha256  2) 母版 sha256（附字节前缀结构检查）
    python tools/trim_song.py check --src <原曲.mp3> --master <母版.mp3>

退出码：0 通过（原曲不匹配只是警告）；1 母版不匹配/结构不符；2 用法错误。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# MPEG Audio 比特率表（kbps），键为 (version_key, layer)；version_key 3 = MPEG1，2 = MPEG2/2.5
BITRATES = {
    (3, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (3, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (3, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
SAMPLE_RATES = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_frame_header(buf: bytes, i: int) -> dict | None:
    if i + 4 > len(buf) or buf[i] != 0xFF or (buf[i + 1] & 0xE0) != 0xE0:
        return None
    h = buf[i:i + 4]
    ver_bits = (h[1] >> 3) & 0x03
    layer_bits = (h[1] >> 1) & 0x03
    br_idx = (h[2] >> 4) & 0x0F
    sr_idx = (h[2] >> 2) & 0x03
    if ver_bits == 1 or layer_bits == 0 or br_idx in (0, 15) or sr_idx == 3:
        return None
    layer = 4 - layer_bits
    key = (3 if ver_bits == 3 else 2, layer)
    if key not in BITRATES:
        return None
    bitrate = BITRATES[key][br_idx] * 1000
    sample_rate = SAMPLE_RATES[ver_bits][sr_idx]
    pad = (h[2] >> 1) & 1
    if layer == 1:
        samples, length = 384, int(12 * bitrate / sample_rate + pad) * 4
    elif layer == 2:
        samples, length = 1152, int(144 * bitrate / sample_rate + pad)
    else:
        samples = 576 if ver_bits == 2 else 1152
        length = int(samples / 8 * bitrate / sample_rate + pad)
    if ver_bits == 0:  # MPEG 2.5
        samples //= 2
    if length <= 4:
        return None
    return {"bitrate": bitrate, "sample_rate": sample_rate, "samples": samples, "length": length,
            "channels": 1 if (h[3] >> 6) & 0x03 == 3 else 2, "mpeg_version": ver_bits, "layer": layer}


def _syncsafe(b: bytes) -> int:
    return (b[0] & 0x7F) << 21 | (b[1] & 0x7F) << 14 | (b[2] & 0x7F) << 7 | (b[3] & 0x7F)


def id3v2_offset(data: bytes) -> tuple[int, dict]:
    """ID3v2 之后的音频起点。v2.3 的长度字段理论上不是 syncsafe，实测两种写法都有，
    所以两种都算，取「后面真能读出 MPEG 帧头」的那个。"""
    if data[:3] != b"ID3":
        return 0, {"present": False}
    flags = data[5]
    info: dict = {"present": True, "version": f"2.{data[3]}", "flags": flags}
    for label, size in (("syncsafe", _syncsafe(data[6:10])), ("plain", int.from_bytes(data[6:10], "big"))):
        off = 10 + size + (10 if flags & 0x10 else 0)
        if off + 4 <= len(data) and parse_frame_header(data, off):
            info.update(bytes=off, size_field=label)
            return off, info
    off = 10 + _syncsafe(data[6:10])
    info.update(bytes=off, size_field="syncsafe（其后读不到 MPEG 帧头）")
    return off, info


def parse_xing(data: bytes, frame_offset: int, head: dict) -> dict | None:
    """在第一帧内部找 Xing/Info 头并解出它的字段。"""
    limit = min(frame_offset + head["length"], len(data))
    for tag in (b"Xing", b"Info"):
        at = data.find(tag, frame_offset + 4, limit)
        if at < 0:
            continue
        flags = int.from_bytes(data[at + 4:at + 8], "big") if at + 8 <= len(data) else 0
        pos = at + 8
        out = {"tag": tag.decode(), "offset_in_frame": at - frame_offset, "flags": flags}
        if flags & 1 and pos + 4 <= len(data):
            out["frames"] = int.from_bytes(data[pos:pos + 4], "big")
            out["frames_offset"] = pos
            pos += 4
        if flags & 2 and pos + 4 <= len(data):
            out["bytes"] = int.from_bytes(data[pos:pos + 4], "big")
            out["bytes_offset"] = pos
            pos += 4
        if flags & 4:
            pos += 100
        if flags & 8 and pos + 4 <= len(data):
            out["quality"] = int.from_bytes(data[pos:pos + 4], "big")
        return out
    return None


def scan_frames(data: bytes, start: int) -> tuple[list[int], dict | None, int]:
    """顺序走一遍 MPEG 帧，返回 (每帧偏移, 第一帧头, 音频结束偏移)。"""
    offsets: list[int] = []
    first: dict | None = None
    cur = start
    while cur + 4 <= len(data):
        head = parse_frame_header(data, cur)
        if head is None:
            break
        if first is None:
            first = head
        elif (head["sample_rate"], head["samples"]) != (first["sample_rate"], first["samples"]):
            break  # 采样率/帧长变了，就不再算同一段流
        offsets.append(cur)
        cur += head["length"]
    return offsets, first, cur


def plan(data: bytes, fps: float) -> dict:
    tag_bytes, tag_info = id3v2_offset(data)
    offsets, head, end = scan_frames(data, tag_bytes)
    if not offsets or head is None:
        raise SystemExit("错误：ID3v2 之后读不到 MPEG 音频帧，这个文件可能不是 MP3。")

    spf, sr = head["samples"], head["sample_rate"]
    n_frames = len(offsets)
    duration = n_frames * spf / sr
    video_frames = int(duration * fps)                 # 尾部小数帧丢掉
    target_end = video_frames / fps if video_frames else duration
    keep = -(-int(round(target_end * sr)) // spf)       # ceil：音频必须盖住整数个视频帧
    keep = max(1, min(keep, n_frames))

    xing = parse_xing(data, offsets[0], head)
    return {
        "id3v2": tag_info,
        "audio_start": tag_bytes,
        "trailing_bytes": len(data) - end,
        "first_frame": head,
        "mp3_frames": n_frames,
        "frame_bytes": sum(offsets[i + 1] - offsets[i] for i in range(len(offsets) - 1)) + (end - offsets[-1]),
        "duration_s": round(duration, 6),
        "video_frames": video_frames,
        "target_end_s": round(target_end, 6),
        "keep_frames": keep,
        "trimmed_duration_s": round(keep * spf / sr, 6),
        "overshoot_s": round(keep * spf / sr - target_end, 6),
        "cut_at": offsets[keep] if keep < n_frames else end,
        "dropped_bytes": len(data) - (offsets[keep] if keep < n_frames else end),
        "xing": xing,
    }


def patch_xing(buf: bytearray, xing: dict, frames: int, stream_bytes: int) -> list[str]:
    """把 Xing/Info 的 frames / bytes 两个字段改成自洽的值。返回改动的说明（没变的字段不报）。"""
    done = []
    for key, value, offset_key in (("frames", frames, "frames_offset"),
                                   ("bytes", stream_bytes, "bytes_offset")):
        off = xing.get(offset_key)
        if off is None or xing.get(key) == value:
            continue
        buf[off:off + 4] = value.to_bytes(4, "big")
        done.append(f"{key} {xing.get(key)} → {value}")
    return done


def cmd_make(args: argparse.Namespace) -> int:
    src, out = Path(args.src), Path(args.out)
    data = src.read_bytes()
    p = plan(data, args.fps)
    cut = p["cut_at"]
    kept = bytearray(data[:cut])
    frame_len = p["first_frame"]["length"]

    if args.patch_info:
        if p["xing"]:
            changed = patch_xing(kept, p["xing"], p["keep_frames"], p["keep_frames"] * frame_len)
            print(f"已改 Xing/Info 头（自洽化，仅描述母版）：{'; '.join(changed)}")
        else:
            print("--patch-info：这个文件没有 Xing/Info 头，未做改动。")
    out.write_bytes(kept)
    src_sha, out_sha = sha256_file(src), sha256_file(out)

    fps = args.fps
    print(f"原曲  {p['duration_s']} s = {p['mp3_frames']} MPEG 帧 = {p['duration_s'] * fps:.3f} 视频帧 @{fps:g}fps")
    print(f"目标  {p['video_frames']} 个整数视频帧，末帧时间 {p['target_end_s']} s")
    print(f"母版  保留前 {p['keep_frames']} 个 MPEG 帧 = {p['trimmed_duration_s']} s"
          f"（比目标多 {p['overshoot_s'] * 1000:.2f} ms），丢弃 {p['dropped_bytes']} 字节")
    print(f"      母版 = 原曲前 {cut} 字节（字节前缀，可用 sha256(原曲[:{cut}]) 手工复核）")
    x = p["xing"]
    if x:
        implied = (x.get("bytes", 0) // frame_len) if frame_len else None
        print(f"注意  Xing/Info 头：tag={x['tag']} frames={x.get('frames')} bytes={x.get('bytes')}"
              f"（bytes ÷ 帧长 = {implied} 帧，但 frames 自称 {x.get('frames')} 帧 → 原件头部自身差一帧）")
        if not args.patch_info:
            print(f"      默认不改头部：头部 bytes 字段仍是原件整段音频的 {x.get('bytes')} 字节"
                  f"（母版实际 {p['keep_frames'] * frame_len}），"
                  f"所以按字节估算长度的解码器会把母版报成原长，多出 24 ms（不影响 -shortest 下的成片）。")
            print("      要让头部自洽：加 --patch-info（会得到另一个 sha256，只能选一个固定下来）。")
    print(f"\n两步校验 sha256:\n  原曲 {src_sha}\n  母版 {out_sha}")

    block = {
        "source": {"sha256": src_sha, "duration_s": p["duration_s"], "mp3_frames": p["mp3_frames"],
                   "bytes": src.stat().st_size},
        "master": {"sha256": out_sha, "duration_s": p["trimmed_duration_s"],
                   "mp3_frames": p["keep_frames"], "bytes": out.stat().st_size,
                   "video_frames": p["video_frames"], "fps": fps,
                   "overshoot_s": p["overshoot_s"], "made_by": "tools/trim_song.py",
                   "xing_patched": bool(args.patch_info and x)},
    }
    print("\n--- 可粘进 Resource/song.json ---")
    print(json.dumps(block, ensure_ascii=False, indent=2))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    spec = json.loads(Path(args.resource).read_text(encoding="utf-8"))
    code = 0
    src = Path(args.src)
    if src.exists():
        got = sha256_file(src)
        want = spec["source"]["sha256"]
        if got.lower() == want.lower():
            print(f"[1/2] 原曲 sha256 匹配：{got}")
        else:
            print(f"[1/2] 警告：原曲 sha256 不匹配，唱词与切点可能漂移\n      实际 {got}\n      期望 {want}")
    elif args.src_required:
        print(f"[1/2] 错误：找不到原曲 {src}")
        code = 1
    else:
        print(f"[1/2] 跳过：{src} 不在本机（原曲只在本地，仓库里只有它的 sha256）")

    if not args.master:
        print("[2/2] 跳过：没有给 --master（母版只在本机，仓库里只有它的 sha256）")
        return code

    master = Path(args.master)
    if not master.exists():
        print(f"[2/2] 错误：找不到母版 {master}")
        return 1
    got = sha256_file(master)
    want = spec["master"]["sha256"]
    if got.lower() == want.lower():
        print(f"[2/2] 母版 sha256 匹配：{got}")
    else:
        print(f"[2/2] 错误：母版 sha256 不匹配 —— 时间轴不可信，不要出片\n"
              f"      实际 {got}\n      期望 {want}\n"
              f"      重新生成：python tools/trim_song.py make --src <原曲> --out <母版>"
              f" --fps {spec['master']['fps']:g}")
        code = 1

    if src.exists() and master.stat().st_size <= src.stat().st_size:
        n = master.stat().st_size
        with src.open("rb") as fs, master.open("rb") as fm:
            prefix_ok = True
            while True:
                a, b = fs.read(1 << 20), fm.read(1 << 20)
                if a[:len(b)] != b:
                    prefix_ok = False
                    break
                if not b:
                    break
        print(f"[结构] 母版是原曲的字节前缀（前 {n} 字节）：{'通过' if prefix_ok else '不符'}")
        code = code or (0 if prefix_ok else 1)
    return code


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="删掉原曲尾部的小数帧，得到成片所对齐的母版（字节级截断，不重编码）")
    sub = ap.add_subparsers(dest="cmd")
    mk = sub.add_parser("make", help="生成母版并打印两步校验用的 sha256")
    mk.add_argument("--src", required=True)
    mk.add_argument("--out", required=True)
    mk.add_argument("--fps", type=float, default=24.0)
    mk.add_argument("--patch-info", action="store_true", help="把 Xing/Info 的 frames/bytes 改成自洽值（会改变 sha256）")
    mk.set_defaults(fn=cmd_make)
    ck = sub.add_parser("check", help="按 Resource/song.json 做两步校验")
    ck.add_argument("--src", default="input/song.mp3")
    ck.add_argument("--master")
    ck.add_argument("--resource", default="Resource/song.json")
    ck.add_argument("--src-required", action="store_true", help="原曲缺失也算失败")
    ck.set_defaults(fn=cmd_check)

    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in ("make", "check", "-h", "--help"):
        argv = ["make", *argv]           # 允许省略子命令
    args = ap.parse_args(argv)
    if not getattr(args, "fn", None):
        ap.print_help()
        return 2
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
