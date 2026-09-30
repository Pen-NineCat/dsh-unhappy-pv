"""Writes the tiny audio/lyrics fixture used by the smoke test and pytest.

Usage::

    uv run python tools/lyrict/tests/make_fixture.py <target-dir>

It writes (all synthetic, nothing is downloaded or copied from a real song):

* ``01 Demo.mp3``  - 20 synthetic mono MPEG-1 Layer III frames, enough for mutagen
* ``01 Demo.flac`` - a STREAMINFO-only FLAC, enough for mutagen
* ``01 Demo.lrc``  - synced lyrics with an ``[offset:]`` and a repeated line
* ``01 Demo.txt``  - unsynced lyrics with an ``[la:]`` tag
* ``02 Unlinked.lrc`` - no matching audio file, for test mode
"""

import os
import struct
import sys

LRC = """[ti:Demo]
[ar:Demo Artist]
[offset:+250]
[00:01.000]first line
[00:02.500]second line
[00:03.000][00:04.000]repeated chorus
[00:05.250]last line
"""

TXT = """[la:eng]
unsynced first line
unsynced second line
"""


def write_mp3(path):
    """20 mono 128 kbps / 44.1 kHz MPEG-1 Layer III frames of 417 bytes each."""
    frame = b"\xff\xfb\x90\xc4" + b"\x00" * (417 - 4)
    with open(path, "wb") as handle:
        handle.write(frame * 20)


def write_flac(path):
    """Minimal FLAC: magic + one STREAMINFO metadata block, no audio frames."""
    streaminfo = struct.pack(">HH", 4096, 4096)  # min/max block size
    streaminfo += b"\x00" * 6  # min/max frame size, both unknown
    # 20 bits sample rate (44100) | 3 bits (channels - 1 = 0, mono) | 5 bits
    # (bits per sample - 1 = 15, i.e. 16 bit) | 36 bits total samples (0):
    # exactly 64 bits that start at the byte after the frame sizes.
    packed = (44100 << 44) | (0 << 41) | (15 << 36) | 0
    streaminfo += packed.to_bytes(8, "big")
    streaminfo += bytes.fromhex("d41d8cd98f00b204e9800998ecf8427e")  # MD5 of an empty stream
    assert len(streaminfo) == 34, len(streaminfo)
    # Metadata block header: last-block flag | type 0 (STREAMINFO) | 24 bit length.
    with open(path, "wb") as handle:
        handle.write(b"fLaC" + bytes([0x80]) + len(streaminfo).to_bytes(3, "big") + streaminfo)


def write_fixture(target):
    os.makedirs(target, exist_ok=True)
    write_mp3(os.path.join(target, "01 Demo.mp3"))
    write_flac(os.path.join(target, "01 Demo.flac"))
    with open(os.path.join(target, "01 Demo.lrc"), "w", encoding="utf-8") as handle:
        handle.write(LRC)
    with open(os.path.join(target, "01 Demo.txt"), "w", encoding="utf-8") as handle:
        handle.write(TXT)
    with open(os.path.join(target, "02 Unlinked.lrc"), "w", encoding="utf-8") as handle:
        handle.write("[00:01.000]orphan line\n")
    return target


def main():
    target = write_fixture(sys.argv[1] if len(sys.argv) > 1 else "lyrict_fixture")
    import mutagen  # deferred so that `--help` style uses stay cheap

    print(f"fixture written to {os.path.abspath(target)}")
    for name in sorted(os.listdir(target)):
        path = os.path.join(target, name)
        audio = mutagen.File(path)
        if audio is None:
            print(f"  {name:16} {os.path.getsize(path)} bytes")
        else:
            print(f"  {name:16} {type(audio).__name__} length={audio.info.length:.3f}s")


if __name__ == "__main__":
    main()
