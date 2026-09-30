"""Tests for the vendored lyrict package.

No third-party test runner is needed: everything runs on the standard library,
so ``uv run python tools/lyrict/tests/test_lyrict.py`` works in a fresh checkout
right after ``uv sync``. (pytest also collects these functions if you happen to
have it: https://docs.pytest.org - ``uv run --with pytest pytest tools/lyrict``.)

The audio files used below are generated on the fly by ``make_fixture.py`` and
contain no audio samples, just enough structure for mutagen.
"""

import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mutagen  # noqa: E402
import lyrict  # noqa: E402
from make_fixture import LRC, TXT, write_fixture  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


# ── parse_lrc_to_sylt ────────────────────────────────────────────────────────

def test_parse_lrc_to_sylt_basic():
    language, entries, omitted = lyrict.parse_lrc_to_sylt("[00:01.000]a\n[00:02.500]b\n")
    assert language == "eng"
    assert entries == [("a", 1000), ("b", 2500)]
    assert omitted == []


def test_parse_lrc_to_sylt_offset_and_language_and_omitted():
    language, entries, omitted = lyrict.parse_lrc_to_sylt(LRC)
    assert language == "eng"
    # [offset:+250] shifts every timestamp by 250 ms.
    assert entries == [
        ("first line", 1250),
        ("second line", 2750),
        ("repeated chorus", 3250),
        ("repeated chorus", 4250),
        ("last line", 5500),
    ]
    # Only the tag lines are unimportable; the SYLT frame will not carry them.
    assert [line.split(" ", 1)[1] for line in omitted] == ["[ti:Demo]", "[ar:Demo Artist]", "[offset:+250]"]


def test_parse_lrc_to_sylt_hours_and_two_digit_milliseconds():
    language, entries, omitted = lyrict.parse_lrc_to_sylt("[01:02:03.45]a\n")
    assert entries == [("a", 3723450)]
    assert omitted == []


# ── standardize_timestamps ───────────────────────────────────────────────────

def test_standardize_keep_repairs_out_of_range_units():
    # 62 minutes is written as [62:00.000]; "keep" turns it into hours instead of
    # dropping the surplus.
    assert lyrict.standardize_timestamps("[62:00.000]a", "keep") == "[01:02:00.000]a"
    # No fractional part in the source, so none is added.
    assert lyrict.standardize_timestamps("[03:20]a", "keep") == "[03:20]a"
    assert lyrict.standardize_timestamps("[00:05.25]a", "keep") == "[00:05.25]a"


def test_standardize_force_forms():
    assert lyrict.standardize_timestamps("[00:05.250]a", "force.xx") == "[00:05.25]a"
    assert lyrict.standardize_timestamps("[00:05.25]a", "force.xxx") == "[00:05.250]a"
    assert lyrict.standardize_timestamps("[00:05]a", "force.xxx") == "[00:05.000]a"
    assert lyrict.standardize_timestamps("[00:05]a", "force.xx") == "[00:05.00]a"
    assert lyrict.standardize_timestamps("[01:02:03.400]a", "force.xx") == "[01:02:03.40]a"


def test_standardize_touches_timestamps_inside_lines_only():
    text = "[00:01.000]words<00:02.000> more<00:03.000> end"
    assert lyrict.standardize_timestamps(text, "force.xxx") == "[00:01.000]words<00:02.000> more<00:03.000> end"


# ── CLI ──────────────────────────────────────────────────────────────────────

def test_cli_version_and_help():
    version = run_module("--version")
    assert version.returncode == 0
    assert lyrict.__version__ in version.stdout

    usage = run_module("--help")
    assert usage.returncode == 0
    assert "tag_external" in usage.stdout


def test_cli_requires_a_mode():
    result = run_module()
    assert result.returncode == 2
    assert "-m" in result.stderr


def test_cli_test_mode_reports_unlinked_lyrics():
    with fixture_dir() as directory:
        result = run_module("-m", "test", "-d", directory)
    assert result.returncode == 0
    assert "02 Unlinked.lrc" in result.stdout


def test_parse_arguments_sets_mode_flags():
    args = lyrict.parse_arguments(["-m", "export", "-d", ".", "-ll"])
    assert args.export_mode is True
    assert args.import_mode is False
    assert args.log_to_disk is True
    assert args.separate_logs is True


# ── import / export against synthetic files ──────────────────────────────────

def test_embed_lyrics_mp3_creates_tags_when_the_file_has_no_id3_header():
    # Regression test: a plain mp3 (no ID3 header) used to fail here, because
    # mutagen's MP3.load() leaves `tags` as None instead of raising
    # ID3NoHeaderError.
    with fixture_dir() as directory:
        path = os.path.join(directory, "01 Demo.mp3")
        results = {"saved": [], "skipped": [], "failed": [], "omitted_lines": []}
        lyrict.embed_lyrics_mp3(path, lyrics=LRC, unsynced_lyrics=TXT, results=results)
        assert results["saved"] == [path]
        assert results["failed"] == []

        audio = mutagen.mp3.MP3(path)
        sylt = audio.tags.getall("SYLT")[0]
        assert sylt.lang == "eng"
        assert sylt.text == [
            ("first line", 1250),
            ("second line", 2750),
            ("repeated chorus", 3250),
            ("repeated chorus", 4250),
            ("last line", 5500),
        ]
        assert audio.tags.getall("USLT")[0].text == TXT


def test_embed_lyrics_flac_and_skipping():
    with fixture_dir() as directory:
        path = os.path.join(directory, "01 Demo.flac")
        results = {"saved": [], "skipped": [], "failed": [], "omitted_lines": []}
        lyrict.embed_lyrics_flac(path, lyrics=LRC, unsynced_lyrics=TXT, results=results)
        assert results["saved"] == [path]
        assert mutagen.flac.FLAC(path)["LYRICS"][0] == LRC

        # Second run without --overwrite must leave the existing tags alone.
        again = {"saved": [], "skipped": [], "failed": [], "omitted_lines": []}
        lyrict.embed_lyrics_flac(path, lyrics="[00:09.000]other", results=again)
        assert again["skipped"] == [path]
        assert mutagen.flac.FLAC(path)["LYRICS"][0] == LRC


def test_import_then_export_round_trip_mp3():
    with fixture_dir() as directory:
        match_categories = lyrict.find_matches(
            lyrics_files={
                "lrc": [os.path.join(directory, "01 Demo.lrc")],
                "txt": [os.path.join(directory, "01 Demo.txt")],
            },
            extensions=["mp3"],
            progress=False,
        )
        results = lyrict.import_lyrics(match_categories, progress=False)
        assert len(results["saved"]) == 1
        assert results["failed"] == []

        # Exporting reads both frames back: the tag lines are gone (SYLT cannot
        # carry them) and the [offset:+250] is baked into every timestamp.
        all_lyrics = {"synced": [], "unsynced": []}
        assert lyrict.process_mp3(os.path.join(directory, "01 Demo.mp3"), all_lyrics, "keep") == (True, True)
        assert all_lyrics["synced"] == [
            (
                os.path.join(directory, "01 Demo.mp3"),
                "\n".join(
                    [
                        "[00:01.250]first line",
                        "[00:02.750]second line",
                        "[00:03.250]repeated chorus",
                        "[00:04.250]repeated chorus",
                        "[00:05.500]last line",
                    ]
                ),
                "eng",
                "",
            )
        ]
        assert all_lyrics["unsynced"][0][1] == TXT


# ── helpers ──────────────────────────────────────────────────────────────────

class fixture_dir:
    """Context manager yielding a temp dir with the generated fixture in it."""

    def __enter__(self):
        self.path = tempfile.mkdtemp(prefix="lyrict-test-")
        write_fixture(self.path)
        return self.path

    def __exit__(self, *exc_info):
        shutil.rmtree(self.path, ignore_errors=True)
        return False


def run_module(*arguments):
    """Run ``python -m lyrict`` with the repo's environment, from the repo root."""
    return subprocess.run(
        [sys.executable, "-m", "lyrict", *arguments],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


def main():
    tests = [(name, value) for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
    failures = []
    for name, test in tests:
        try:
            test()
        except Exception as error:  # noqa: BLE001 - this is a test runner
            failures.append((name, error))
            print(f"FAIL {name}: {type(error).__name__}: {error}")
        else:
            print(f"ok   {name}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
