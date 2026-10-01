# lyrict
## Python script to recursively check, standardize, import and export embedded and external synced and unsynced lyrics of audio files.

> **This copy is vendored into the `dsh-unhappy-pv` repository and repackaged.**
> Upstream is [`AverageHoarder/lyrict`](https://github.com/AverageHoarder/lyrict)
> (MIT, Copyright (c) 2024 Malte - see [LICENSE.txt](LICENSE.txt)). What changed
> here is described under [Packaging and local changes](#packaging-and-local-changes):
> the layout is a normal installable package and the dependencies are managed by
> the repository's own `uv` workspace.
> Everything below this note is the upstream README, with `lyrict ...` turned
> into `lyrict ...` to match the installed command.

I initially wrote this as a testing tool to find unlinked .lrc files in my music library. The only link between .lrc and audio files is an identical base name. When audio files are automatically renamed through software but the .lrc files are not, this link can break.<br>
In test mode, the script will recursively scan a given directory for .lrc files (synced lyrics) and .txt files (unsynced lyrics). It then finds matching music files (default: flac and mp3) and logs those .lrc and .txt files without matching audio files as unlinked. It can also log all matches (sorted by filetype) as lists of paths to disk in case these are wanted for further processing in other software.

Later on I added another mode that utilizes [Mp3tags](https://www.mp3tag.de/en/) (limited) cli functionality to open all audio files that do have synced or unsynced external lyrics in Mp3tag (Windows/Mac only). The mp3tag mode can create actions for Mp3tag that allow an easy way to back up existing embedded lyrics, embed the external lyrics and then delete the previously created backups.<br>
This mode is customizable and flexible concerning the used tags and only limited by Mp3tags internal mappings and supported tags.<br>
However Mp3tag does not support the SYLT frame of mp3 files, where synced lyrics are saved as per specification and exporting lyrics from within Mp3tag to external lyrics is also not easily done. This mode also cannot delete the external lyrics files after embedding them.

Which led me to create the third mode, export mode. Export mode uses [mutagen](https://mutagen.readthedocs.io/en/latest/) to scan all audio files in a given directory for embedded lyrics, both synced and unsynced, and can then export these tags to external .lrc and .txt files. This mode does support both LYRICS and UNSYNCEDLYRICS vorbis tags (flac files) and SYLT and USLT frames (mp3 files). For mp3 files it also exports the vorbis tag LYRICS as some people prefer it over the restrictive SYLT frame. It can also purge the existing embedded lyrics after a successful export.

After which I added a fourth mode, import mode. Import mode also uses mutagen to import .lrc and .txt lyrics into flac and mp3 files and is currently rigid. For flac files it uses LYRICS/UNSYNCEDLYRICS vorbis tags and for mp3 files it uses the SYLT/USLT frames to embed lyrics. It can delete the external lyrics files after a successful import.

Finally I added tag_external mode to populate/fix/clean up existing external .lrc and .txt files. This mode tries to populate the header of .lrc and .txt files with information it extracts from linked .mp3 and .flac files while also updating and preserving existing tags.

Export mode, import mode and tag_external mode also support fixing/standardizing of lrc timestamps (optional). There are many different timestamp formats:<br>
`[mm:ss.xx] text`, `[m:ss.xxx]text`, `[mmm:ss.xxx]`, `[hh:mm:ss.xxx]`, `[mm:ss]` just to name a few.
I decided to detect all of these versions (and mixes between them) and tidy them up/fix them:<br>
The script can either respect the source format:<br>
`[62:00.000]text` becomes `[01:02:00.000]text` to correctly represent the hours while
`[03:20]` remains `[03:20]` as adding 3 zeros to it would give no extra precision and simply wastes space.
Alternatively it can force all existing timestamps into `[hh:mm:ss.xxx]text` and `[mm:ss.xxx]text` or `[hh:mm:ss.xx]text` and `[mm:ss.xx]text`.
When the script has to create timestamps (when exporting from sylt), it will always choose `[mm:ss.xxx]lyrics` for timestamps without hours and `[hh:mm:ss.xxx]lyrics` for those with hours.



All modes support logging and can show progress bars for most of the steps.

## Modes

**What can the test mode do?**
  * recursively scan for .lrc and .txt files in a given directory
  * look for audio files with a matching base name (extensions can be specified, default: flac & mp3)
  * log unlinked .lrc and .txt files as well as linked music files to disk
  
**What can the mp3tag mode do?**
  * everything the test mode does plus:
  * open only music files with linked external lyrics in Mp3tag
  * create action for Mp3tag to back up existing embedded lyrics
  * create actions for Mp3tag to embed external lyrics, both .lrc and .txt (overwrites embedded lyrics)
  * create action for Mp3tag to delete previously created lyrics backup
  * supports all tags and audio formats that Mp3tag does (for better and for worse)
  
**What can the import mode do?**
  * everything the test mode does plus:
  * embed external synced and unsynced lyrics into flac and mp3 files (skip existing or purge and overwrite existing lyrics)
  * currently supported tags: vorbis LYRICS, UNSYNCEDLYRICS for flac and id3 frames: SYLT, USLT for mp3
  * standardize and fix timestamps of synced lyrics to one of the available timestamp formats (optional, flac only, as SYLT uses different formatting)
  * apply an offset from the `[offset:+-ms]` tag when importing to SYLT to achieve accurate timestamps
  * detect and properly split repeated lines `[02:05.300][02:15.100]chorus` when importing to SYLT
  * set the language of the embedded lyrics when it is present as `[la:language-code]` within the first 20 lines of the lyrics file
  * log the file path and lines that cannot be imported to SYLT
  * delete external lyrics files after a successful import
  * log results to disk

**What can the export mode do?**
  * recursively scan for music files with embedded lyrics in a given directory (extensions can be specified, default: flac & mp3)
  * export embedded lyrics to external .lrc and .txt files (skip existing or overwrite)
  * update/create [la:languagecode] tag based on the language tag of the embedded lyrics
  * currently supported tags: vorbis: LYRICS, UNSYNCEDLYRICS for flac files, vorbis: LYRICS + id3 frames: SYLT, USLT for mp3 files
  * standardize and fix timestamps of synced lyrics to one of the available timestamp formats
  * purge embedded tags after a successful export
  * log results to disk

**What can the tag_external mode do?**
  * everything the test mode does plus:
  * extract information from linked audio files and save it as tags to the header of .lrc/.txt file
  * supported formats: mp3 and flac
  * supported fields to extract: artist, album, title, lyricist/composer, length
  * preserve/update and reorder existing tags in .lrc and .txt files
  * supported existing tags: ar, al, ti, au, length, la, offset, by, re/tool, ve
  * existing tags will be updated with information from linked audio files and rewritten as the header of the .lrc/.txt files
  * standardize and fix timestamps of synced lyrics to one of the available timestamp formats
  * rewrite only those .lrc/.txt files with changed content

## How to install lyrict

### In this repository — **currently not runnable**

The repository's rendering pipeline moved to pure Node.js, so on 2026-10-01 its
Python environment was removed: there is no root `pyproject.toml`, no `uv`
workspace and no `.venv` to resolve. Any `uv sync` / `uv run lyrict` instructions
that used to live here no longer apply.

This vendored copy is kept (small, MIT, and possibly wanted again for exporting
or importing lyric tags). To run it, build a throwaway environment **outside the
repository** — `.gitignore` covers `.venv` only, so a venv created in the repo
would show up as an untracked directory:

```powershell
python -m venv "$env:TEMP\lyrict-venv"
& "$env:TEMP\lyrict-venv\Scripts\pip" install ./tools/lyrict   # pulls mutagen + tqdm
& "$env:TEMP\lyrict-venv\Scripts\lyrict" -m test -d input
```

Nothing in the rendering pipeline depends on this tool: `input/song.lrc` is
already on hand.

### Standalone (outside this repository)

The package is self-contained, so it can also be installed on its own:

```bash
pip install ./tools/lyrict            # from this repository
pip install "lyrict @ git+https://github.com/Pen-NineCat/dsh-unhappy-pv#subdirectory=tools/lyrict"
```

Upstream is not on PyPI, so there is no plain `pip install lyrict`.

### Prerequisites

**Required:**
1. [python](https://www.python.org/downloads/) must be installed (tested with python 3.12.3)
2. [mutagen](https://mutagen.readthedocs.io/en/latest/) - installed automatically with the package above
3. [tqdm](https://github.com/tqdm/tqdm) - also installed automatically; upstream treated it as optional, but the script imports it unconditionally

**Optional:**
1. when using `-m mp3tag` as mode, [Mp3tag](https://www.mp3tag.de/en/) must be installed and on PATH

If Mp3tag is not on PATH, the script will complain and (if on Windows) open the environment variables settings with instructions on how to add it to PATH.

## Usage

### Output from -h:

```
usage: lyrict [-h] [-d [DIRECTORY]] [--delete] [-e EXTENSIONS [EXTENSIONS ...]] [-l]
              [--log_path [LOG_PATH]] -m {export,import,mp3tag,test,tag_external} [-o] [-p]
              [-s] [--standardize [{keep,force.xx,force.xxx}]] [--version]

Test .lrc and .txt lyrics for broken links, embed synced and unsynced lyrics into tags, extract
them from tags to files or populate the tags of external lyrics based on the tags of linked files.

options:
  -h, --help            show this help message and exit
  -d [DIRECTORY], --directory [DIRECTORY]
                        test, import, mp3tag, tag_external: The directory to scan for .lrc and
                        .txt files. export: Directory to scan for music files.
  --delete              Import: After successful import, deletes external .lrc and .txt files from
                        disk. Export: After successful export, deletes LYRICS, SYLT and USLT tags
                        from mp3 files and LYRICS and UNSYNCEDLYRICS tags from flac files.
  -e EXTENSIONS [EXTENSIONS ...], --extensions EXTENSIONS [EXTENSIONS ...]
                        Test, Import, mp3tag: List of song extensions the script will look for,
                        default: flac and mp3. Export: Song extensions that will be scanned for
                        embedded lyrics, default flac and mp3
  -l, --log             Test, mp3tag: Log filepaths (lyric and music extension) to
                        "lyrict_results.log". "-ll" logs each filetype separately (lrc_flac.log,
                        txt_mp3.log...) instead. Import, Export: log embedding/exporting results
                        to "lyrict_import_results"/"lyrict_export_results"
  --log_path [LOG_PATH]
                        The directory to save logs to when used with -l or -ll, defaults to "."
  -m {export,import,mp3tag,test,tag_external}
                        Mode, use 'test' to only log linked/unlinked songs to console or to
                        file(s) when used with -l or -ll. Use 'mp3tag' to embed external lyrics
                        (.txt/.lrc) in audio tags via mp3tag. Use 'import' to embed external
                        lyrics (.txt/.lrc) in audio tags via mutagen. Use 'export' to export
                        embedded tags to external files (.lrc/.txt) via mutagen. Use
                        'tag_external' to rewrite existing .lrc/.txt files and populate/update tag
                        information like [ar:artist] at the start of the file.
  -o, --overwrite       mp3tag: Overwrite/recreate the mp3tag actions to reflect changes made in
                        the config section. Import: Purge and overwrite existing embedded lyrics
                        tags (LYRICS/UNSYNCEDLYRICS/SYLT/USLT) Export: Overwrite the content of
                        existing .lrc/.txt files.
  -p, --progress        Show progress bars. Useful for huge directories. Requires tqdm, use "pip3
                        install tqdm" to install it.
  -s, --single_folder   Test, Import, mp3tag: Only scans a single folder for .lrc and .txt files,
                        no subdirectories. Export: Only scans a single folder for music files.
  --standardize [{keep,force.xx,force.xxx}]
                        Import/Export/tag external: standardize and fix timestamps of synced
                        lyrics. Use 'keep' or leave empty to retain existing timestamp formats and
                        only fix mistakes like >59 minutes or >59 seconds. Use 'force.xx' to force
                        all existing timestamps into `[hh:mm:ss.xx]` or `[mm:ss.xx]` format. Use
                        'force.xxx' to force all existing timestamps into `[hh:mm:ss.xxx]` or
                        `[mm:ss.xxx]` format
  --version             Show the lyrict version and exit.
```

### More elaborate explanations of the modes and arguments:

**When called with -m test**<br>
**Test Mode:**<br>
This mode scans a directory and all subdirectories for .lrc and .txt files.<br>
The .txt files are filtered to match a common music file naming scheme: 2 or 3 digits followed by a space at the start of the filename. "01 Hello.flac" for example. This prevents matching info.txt and many other .txt files that are not unsynced lyrics. If your naming differs you have to adjust the regular expression as described in the "How to tweak behavior" section.<br>
Then this mode tries to find matching audio files, testing all extensions passed with -e, --extensions (default flac, mp3).<br>
Per default only unlinked songs (where no match was found) are logged to console.

**When called with -m mp3tag**<br>
**mp3tag Mode (requires Mp3tag, Windows/Mac only):**<br>
This does everything that Test Mode does and then opens only the songs with linked external lyrics in Mp3tag. Before that it checks if Mp3tag is on PATH and instructs the user on how to add it to PATH if it is not.<br>
Then it asks to create 4 actions for Mp3tag. They can back up existing embedded lyrics, embed .lrc files and .txt files to audio tags and lastly delete previously created backups.  
Both the names of the actions that will be created and the tags the actions should backup and embed to, are configurable in the CONFIG section at the top of the script. The default tag for synced lyrics is the vorbis tag LYRICS, for unsynced lyrics the default tag is UNSYNCEDLYRICS which Mp3tag internally maps to the USLT frame for mp3 files.<br>
When using this mode you have to be aware of the **internal mappings** of Mp3tag to ensure that the tags end up what you want them to be.<br>
The SYLT frame for example is **not supported** in Mp3tag, therefore synced lyrics will also be embedded to the LYRICS vorbis tag for mp3 files.<br>
The actions in Mp3tag will always overwrite existing embedded tags. They also cannot delete the external lyrics files after embedding them.

**When called with -m import**<br>
**Import Mode (requires mutagen):**<br>
This does everything that Test Mode does and then uses mutagen to embed external .lrc and .txt files to audio tags.  
Currently this mode is rigid and only supports embedding the vorbis tags LYRICS and UNSYNCEDLYRICS to flac files and the id3 frames SYLT and USLT to mp3 files.  
When -o, --overwrite is specified, existing embedded lyrics are purged and then written anew.  
When --delete is specified, the script will delete only those .lrc and .txt files that were embedded into an audio file.  
--standardize will fix and standardize the timestamps of the lyrics depending on their source formatting and user choice.
Both at the start of the line `[mm:ss.xxx]normal lyrics line` and within a line `[mm:ss.xxx]words<mm:ss.xxx> synced<mm:ss.xxx> line`.
**BEWARE**: SYLT frames are very strict concerning the formatting.  
Lines in .lrc files that do not start with a timestamp (or multiple for repeated lines) are not stored in the SYLT frame and **will be lost**.
With `-l` or `-ll`, such omitted lines will be logged with the line number and the file path.
So DO check the logs before using `--delete` as that would result in permanently losing the information that cannot be embedded to the SYLT frame of mp3s.
These limitations only apply when embedding .lrc files into the SYLT frame of .mp3 files.

**When called with -m export**<br>
**Export Mode (requires mutagen):**<br>
This mode scans a directory and all subdirectories for audio files specified with -e, --extensions (default flac, mp3).<br>
It then uses mutagen to check if the audio files have embedded lyrics. Flac files are scanned for the vorbis tags LYRICS and UNSYNCEDLYRICS and mp3 files are scanned for the vorbis tag LYRICS as well as the id3 frames SYLT and USLT.<br>
Next, the script uses mutagen to export the synced and unsynced lyrics to .lrc and .txt files.<br>
When -o, --overwrite is not specified, existing external lyrics are skipped, otherwise they will be overwritten.<br>
When --delete is specified, the embedded lyrics tags of files where the export was successful (saved/skipped) will be purged.<br>
--standardize will fix and standardize the timestamps of the lyrics depending on their source formatting and user choice.
Both at the start of the line `[mm:ss.xxx]normal lyrics line` and within a line `[mm:ss.xxx]words<mm:ss.xxx> synced<mm:ss.xxx> line`.

**When called with -m tag_external**<br>
**Tag External Mode (requires mutagen):**<br>
This does everything that Test Mode does and then updates the tags of .lrc and .txt files based on the tags of linked audio files. It also preserves existing tags in external lyrics files.
It currently supports flac and mp3 files, of which these tags are extracted: artist, album, title, lyricist/composer, length
Other existing tags are also preserved, these are supported: ar, al, ti, au, length, la, offset, by, re/tool, ve
The existing tags will be updated with information from linked audio files and rewritten as the header of the .lrc/.txt files.
--standardize will fix and standardize the timestamps of the lyrics depending on their source formatting and user choice.
Both at the start of the line `[mm:ss.xxx]normal lyrics line` and within a line `[mm:ss.xxx]words<mm:ss.xxx> synced<mm:ss.xxx> line`.
Only changed .lrc/.txt files will be rewritten.

**-d, --directory PATH (optional, default=".")**<br>
When run without -d, the script will be called in the folder it was executed from.<br>
If -d is supplied, it must be followed by a valid path to a directory, which will be scanned for .lrc/.txt or audio files, depending on the mode.

**--delete (optional, destructive)**<br>
When used in import mode, successfully embedded external lyrics will be deleted.<br>
When used in export mode, successfully exported embedded lyric tags will be purged.

**-o, --overwrite (optional, destructive)**<br>
When used in import mode, purges and then recreates embedded lyrics.<br>
When used in export mode, overwrites existing .lrc and .txt files.

**--standardize keep (optional)**<br>
When used in import mode, the timestamps for synced lyrics that will be imported to the vorbis tag LYRICS will be reformatted to `[mm:ss.xxx]`, `[hh:mm:ss.xxx]`, `[mm:ss]` or `[hh:mm:ss]` (depending on their source format). Timestamps within lines `[mm:ss.xxx]text<mm:ss.xxx> text<mm:ss.xxx> text` and repeated timestamps `[mm:ss.xxx][mm:ss.xxx]text` are also fixed. Lines that do not contain timestamps will be carried over as they are. Since the SYLT frame uses a different format, it is not affected by this standardization as all detected timestamps are converted to miliseconds.<br>
When used in export mode or tag_external mode, the timestamps formatting for .lrc files will be respected, source formats of `[mm:ss.xxx]`, `[hh:mm:ss.xxx]`, `[mm:ss.xx]`, `[hh:mm:ss.xx]` `[mm:ss]` and `[hh:mm:ss]` are supported. Timestamps within lines `[mm:ss.xxx]text<mm:ss.xxx> text<mm:ss.xxx> text` and repeated timestamps `[mm:ss.xxx][mm:ss.xxx]text` are also fixed.

**--standardize force.xx (optional)**<br>
When used in import mode, the timestamps for synced lyrics that will be imported to the vorbis tag LYRICS will be reformatted to `[mm:ss.xx]text` and `[hh:mm:ss.xx]text`. Timestamps within lines `[mm:ss.xx]text<mm:ss.xx> text<mm:ss.xx> text` and repeated timestamps `[mm:ss.xx][mm:ss.xx]text` are also fixed. Lines that do not contain timestamps will be carried over as they are. Since the SYLT frame uses a different format, it is not affected by this standardization as all detected timestamps are converted to miliseconds.<br>
When used in export mode or tag_external mode, all timestamps for .lrc files will be created as/changed to `[mm:ss.xx]` and `[hh:mm:ss.xx]`

**--standardize force.xxx (optional)**<br>
When used in import mode, the timestamps for synced lyrics that will be imported to the vorbis tag LYRICS will be reformatted to `[mm:ss.xxx]text` and `[hh:mm:ss.xxx]text`. Timestamps within lines `[mm:ss.xxx]text<mm:ss.xxx> text<mm:ss.xxx> text` and repeated timestamps `[mm:ss.xxx][mm:ss.xxx]text` are also fixed. Lines that do not contain timestamps will be carried over as they are. Since the SYLT frame uses a different format, it is not affected by this standardization as all detected timestamps are converted to miliseconds.<br>
When used in export mode or tag_external mode, all timestamps for .lrc files will be created as/changed to `[mm:ss.xxx]` and `[hh:mm:ss.xxx]`

**-s, --single_folder (optional)**<br>
Changes the behaviour of the script to be non-recursive. Only the directory specified with -d will be scanned.

**-l, --log**<br>
Depending on the mode, either linked/unlinked paths to audio files will be logged (test mode/mp3tag mode) or the results of an import/export will be logged (import mode/export mode).

**-p, --progress (optional)**<br>
Show progress bars during scanning, matching, embedding and exporting. Useful for huge directories.


## Common examples

### Case 1: test mode, searching for external lyrics with broken links:
* minimal version, recursively scan and only log unlinked .lrc/.txt files to console<br>
`lyrict -m test`

* log to combined logs<br>
`lyrict -m test -l`
  
* log to combined logs and show progress bars<br>
`lyrict -m test -lp`

* log to combined logs, show progress bars, specify a directory to scan and extensions to match<br>
`lyrict -m test -lp -d "D:\Test" -e flac mp3 ogg m4a`

### Case 2: mp3tag mode, opening linked songs in Mp3tag to embed lyrics:
* log unlinked lyrics to console, open linked songs in Mp3tag<br>
`lyrict -m mp3tag`

* log to combined logs and open linked songs in Mp3tag<br>
`lyrict -m mp3tag -l`
  
* overwrite/recreate Mp3tag actions and show progress bars<br>
`lyrict -m mp3tag -op`

* show progress bars, specify a directory to scan and extensions to match<br>
`lyrict -m mp3tag -p -d "D:\Test" -e flac mp3 ogg m4a`

### Case 3: import mode, embed external lyrics in flac and mp3 files:
* embed synced and unsynced external lyrics recursively, skip if embedded lyrics already exist<br>
`lyrict -m import`

* log results to disk<br>
`lyrict -m import -l`
  
* overwrite embedded lyrics and show progress bars<br>
`lyrict -m import -op`

* overwrite embedded lyrics, show progress bars and delete external lyrics that were embedded, specify a directory<br>
`lyrict -m import -op --delete -d "D:\Test"`

### Case 4: export mode, extract embedded lyrics and write them to .lrc and .txt files:
* export embedded synced and unsynced lyrics to .lrc and .txt files, skip existing<br>
`lyrict -m export`

* log results to disk<br>
`lyrict -m export -l`

* overwrite external lyrics and show progress bars<br>
`lyrict -m export -op`

* overwrite external lyrics, show progress bars and purge embedded lyrics that were exported, specify a directory<br>
`lyrict -m export -op --delete -d "D:\Test"`

### Case 5: tag_external mode, populate, update and preserve tags of linked .lrc and .txt files:
* find matching songs and create/update/reorder the tag section of .lrc and .txt files<br>
`lyrict -m tag_external`

* log results to disk<br>
`lyrict -m tag_external -l`

* display progress bars<br>
`lyrict -m tag_external -lp`

* standardize timestamps of .lrc files, respecting the source format<br>
`lyrict -m tag_external -lp --standardize`

* standardize timestamps of .lrc files, force all timestamps into `[mm:ss.xxx]` and `[hh:mm:ss.xxx]` format<br>
`lyrict -m tag_external -lp --standardize force.xxx`

## Packaging and local changes

This copy lives in `tools/lyrict/` of the `dsh-unhappy-pv` repository. Compared
with upstream's single `lyrict.py`, only the following is different - the modes,
arguments and output are unchanged:

| | upstream | here |
|---|---|---|
| layout | one `lyrict.py` you copy around | `src/lyrict/` package with `pyproject.toml` |
| call it | `python lyrict.py -m ...` | `lyrict -m ...` or `python -m lyrict -m ...` |
| dependencies | install mutagen/tqdm yourself | declared in its own `pyproject.toml` (`pip install ./tools/lyrict` pulls them) |
| version | none published | `lyrict --version` (placeholder `0.0.0+vendored`) |

Also changed:

* imports use the public `mutagen.id3` names (`TXXX`, `ID3NoHeaderError`)
  instead of upstream's private `mutagen.id3._frames` / `mutagen.id3._util`
  paths, so a mutagen refactor cannot break the import;
* `cli()` returns an exit status instead of calling `os._exit()`.

**Three upstream bugs were fixed**, because they were silent or fatal in
`-m import` / `-m export`:

1. **Repeated timestamps got the wrong times.** `[00:03.000][00:04.000]chorus`
   was written to the SYLT frame twice at the *same*, wrong time (the time of an
   unrelated earlier line), because the loop read a stale regex match. Each
   timestamp is now used for its own entry.
2. **Importing into an mp3 without an ID3 header always failed.** Upstream caught
   `ID3NoHeaderError` and called `add_tags()`, but mutagen's `MP3.load()`
   swallows that error and leaves `tags` as `None`, so the except branch never
   ran and every such file failed with `AttributeError: 'NoneType' object has
   no attribute 'values'`. An empty tag set is now created from the `None` case.
3. **The unsynced lyrics of an mp3 were dropped on export.** `process_mp3()`
   used `elif` between the SYLT, USLT and TXXX frames, so a file that had both a
   SYLT and a USLT frame - exactly what `-m import` writes - reported only its
   synced lyrics. The three cases are now independent.

## Tests

`tests/` contains a stdlib-only test suite and the fixture generator it uses
(tiny synthetic .mp3/.flac files, no audio, no real lyrics):

This repository no longer has a Python environment (see "In this repository"
above), and the suite imports `mutagen`, so use a throwaway interpreter — it
needs the dependencies but no test framework:

```powershell
python -m venv "$env:TEMP\lyrict-venv"
& "$env:TEMP\lyrict-venv\Scripts\pip" install ./tools/lyrict
& "$env:TEMP\lyrict-venv\Scripts\python" tools\lyrict\tests\test_lyrict.py   # 13/13 passed, 2026-10-01
```

`tests/make_fixture.py <dir>` writes the same fixture to a directory of your
choosing if you want to poke at the CLI by hand.

## How to tweak behavior

* If you want to change the Mp3tag action names or the tags used for synced and unsynced lyrics in Mp3tag, modify the config section at the top of the script.

* During scanning, if your music files are named in a different pattern than "01 Hello.flac", you can edit the regular expression in this line to change the .txt matching:<br>
`pattern = r'^\d{2,3}\s'` replacing the regex with `r'^\d{2,3}_'` for example would match "01_Hello.flac" instead of "01 Hello.flac".

* During import, if you want to save the mp3 tags as id3 2.4 instead of id3 2.3 (chosen for compatibility), you can edit this line:<br>
`audio.save(v2_version=3)` and change `v2_version=3` to `v2_version=4`.

## Known Issues
 * During export, `--standardize force.xx` has no effect on the .lrc files produced from an mp3 SYLT frame: `extract_sylt_to_lrc()` always writes three decimal places and that output is not re-run through the standardizer. The timestamps themselves are correct, only the number of digits can differ from what you asked for.
 * During export, when an mp3 file has both the vorbis tag LYRICS and a SYLT frame, only one of them is written to an .lrc file. The other one is skipped. If -o, --overwrite is used, instead of being skipped, the first value will be overwritten with the second value. If LYRICS and SYLT have identical content, this should not matter. It could matter if SYLT contains less than LYRICS. Check when in doubt.

 * During export, when an mp3 file and a flac file with identical path and basename both have synced or unsynced lyrics embedded, only the lyrics of one of them will be written to .lrc and .txt, the other one will be skipped or overwritten if -o, --overwrite is used. Assuming that they are the same song with identical lyrics, this should also not matter.
 
 * Mp3tag does not support the SYLT frame. This means that when performing certain actions on mp3 files containing a SYLT frame in Mp3tag, that frame can be lost. (removing the tags and then undoing that step for example deletes the SYLT frame as it is not written back).
 
 * During import, when embedding synced lyrics from .lrc files to SYLT frames in mp3 files, any lines that do not begin with a timestamp WILL BE LOST. This is a limitation of the SYLT frame.
 
 * I've changed a couple dozen lines of code over the last few days and have not yet tested every possible combination of arguments. Consider this script a beta version at best, only use it on copies of your files or at the very least have an up-to-date backup of your files before using it. Also verify the results! I won't be responsible for lost lyrics.

