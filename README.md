# Kdenlive Project MCP

A local MCP server and TypeScript library for incremental editing of existing
Kdenlive projects. The first implementation preserves the original XML and
changes selected timeline entries instead of regenerating the project.

**Status:** cuts, clip volume/fades, local PCM16 WAV import and audio
insertion/replacement are implemented. Synthetic audio fixtures have been tested
with Kdenlive 26.08.2 on macOS. The complete MVP is still in progress; see
[current status](docs/STATUS.md) for supported structures and evidence limits.

## Run locally

Use Node.js 24 LTS and pnpm 11.17.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm start --root /absolute/path/to/project-folder
```

The last command waits for an MCP client on standard input. Configure a client
with the equivalent of [examples/mcp.json](examples/mcp.json), replacing its
absolute paths. Include each media folder as another `--root` if it lies outside
the project folder. The server needs no credentials or running editor.

Save work in Kdenlive before opening it through MCP. The server reads saved files;
it cannot see unsaved GUI changes. Open the resulting copy in Kdenlive to inspect
and continue editing it.

## Tools

These are the **seven implemented MCP tools**. All seven are covered by automated
tests and the real-process stdio acceptance flow. Native editor evidence is
listed separately under [Validated behavior](#validated-behavior).

| Tool | Input | Implemented behavior |
| --- | --- | --- |
| `project_open` | `path` | Open a saved `.kdenlive` within allowed roots; return session UUID, revision and project information |
| `project_info` | `sessionId` | Inspect the current in-memory revision, document version, rational FPS, sequence ID/count, duration, tracks, clips, clip audio settings and media/bin membership |
| `project_validate` | `sessionId` | Report recognized media as `present`, `missing`, `forbidden`, `generated` or `unsupported`, with an aggregate `valid` result |
| `project_import_audio` | `sessionId`, `expectedRevision`, `path` | Add a local PCM16 mono/stereo WAV reference to the bin; return `sourceId`, `durationFrames` and updated information/revision |
| `timeline_apply` | `sessionId`, `expectedRevision`, `operations` | Atomically apply the five operations below and return updated information/revision |
| `project_save_as` | `sessionId`, `expectedRevision`, `path` | Save the current revision to a new sibling `.kdenlive`; return path, revision, byte count and confirmation that the source was preserved |
| `project_close` | `sessionId` | Release a session and discard unsaved in-memory changes |

### Timeline operations

| Operation | Fields besides `type` | Implemented behavior |
| --- | --- | --- |
| `remove_ranges` | `trackId`, `ranges: [{start, end}]` | Remove one or more timeline ranges, including ranges spanning blanks/clips; close gaps only on that track and update duration |
| `split_clip` | `clipId`, `offset` | Split an entry at an offset relative to the clip; retain total duration and continuous source ranges |
| `set_clip_audio` | `clipId`, `gainDb`, `fadeInFrames`, `fadeOutFrames` | Set, reconfigure or remove managed clip-local volume/fades without changing other instances of the source |
| `insert_audio_clip` | `trackId`, `sourceId`, `at`, `sourceIn`, `sourceOut` | Insert audio from the bin into an empty track, fill a blank or append; preserve existing clip positions and extend project duration if needed |
| `replace_audio_clip` | `clipId`, `sourceId`, `sourceIn` | Replace the source of an eligible audio clip, retaining its timeline position and duration |

MCP batches accept 1–100 operations, with at most one operation per track.
Each `remove_ranges` accepts 1–1000 ranges. Insertion refuses overlap;
replacement requires an effect-free target and enough source frames. Removing
the entire duration of a track is refused. These operations do not implement
automatic silence detection or editorial selection of ranges.

Successful import/edit calls advance the revision. Import, edit and save require
`expectedRevision`; stale revisions are rejected. A failed import or edit leaves
XML and revision unchanged. Save/import lock the session against competing
mutations or closing. Tool results include structured data; action errors return
`isError` with `code` and `message`.

All operation times are **integer project frames**, with half-open ranges
`[start, end)`. At 25 fps, `[25, 50)` removes exactly one second. Discover track
and clip IDs through `project_info`; never assume a particular ID in another
project. Clip handles are valid only for the revision where they were read.

Example `timeline_apply` arguments after opening a project:

```json
{
  "sessionId": "<session UUID returned by project_open>",
  "expectedRevision": 0,
  "operations": [{
    "type": "remove_ranges",
    "trackId": "<track ID returned by project_info>",
    "ranges": [{ "start": 25, "end": 50 }, { "start": 100, "end": 125 }]
  }]
}
```

Removal closes the gaps **only on the selected track**. Other tracks stay in
place. A split uses `{ "type": "split_clip", "clipId": "...", "offset": 100 }`,
where the offset is relative to the start of that clip. A batch permits one
operation per track; combine multiple cuts in one `remove_ranges` operation.
The entire batch rolls back on failure. Save with the returned revision and a
new sibling path, such as `/absolute/path/to/project-folder/edited.kdenlive`.

## Audio operations

Use `set_clip_audio` with `clipId`, `gainDb`, `fadeInFrames` and `fadeOutFrames`.
Gain accepts -60 through +20 dB. Each fade is zero (disabled) or at least two
frames; their combined duration cannot exceed the clip. Only audio-only media
and recognized MCP-created effect stacks are supported. Setting all three values
to zero removes that stack. Other instances of the same source stay unchanged.

Choose music sources from `project_info.media` where `inProjectBin` is true.
The operation still validates audio eligibility and available source duration.

```json
{"type":"insert_audio_clip","trackId":"<audio track>","sourceId":"<bin source>","at":25,"sourceIn":0,"sourceOut":100}
```

Insertion fills a gap or appends to an audio track. It refuses overlap and never
moves existing clips. `sourceOut` is exclusive. To replace an effect-free clip
while retaining its position and duration:

```json
{"type":"replace_audio_clip","clipId":"<current clip>","sourceId":"<bin source>","sourceIn":50}
```

Reinspect the revision to obtain current clip handles after each edit. Apply
insertion, replacement and audio settings on the same track in separate batches.

## Import local audio

Call `project_import_audio` with the current session and revision:

```json
{
  "sessionId": "<session UUID>",
  "expectedRevision": 0,
  "path": "/absolute/path/to/media/music.wav"
}
```

The response contains `sourceId`, `durationFrames` and updated project information,
including `revision`. Use `sourceId` and `revision` in a subsequent `timeline_apply`
insertion or replacement, then save using the revision returned by that edit.
Import adds the media to the bin; it does not place a clip on the timeline.

The file must be within an allowed root. Import stores an absolute reference
without copying or converting the media, so retain the source file. The initial
support is classic little-endian RIFF/WAV, integer PCM16, mono or stereo, with
consistent headers and a nonempty data chunk. Duration is rounded down to whole
project frames; files shorter than one frame are refused. Float, compressed,
extensible WAV and RF64 are unsupported. Reimporting the same canonical path is
refused. Import failures leave XML and revision unchanged.

The supported WAV header has one classic 16/18-byte `fmt` chunk, one nonempty
`data` chunk, coherent block alignment/byte rate and at most 1024 chunks.
Additional chunks and odd-byte padding are handled; corrupted FourCC identifiers
are rejected. Inspection reads headers without loading the whole audio payload.
Import requires document version `1.1`, a single sequence and a non-self-closing
`main_bin` playlist; its layout checks differ from timeline editing checks.

## Validated behavior

Evidence reviewed on **2026-10-15**. Automated checks establish the supported
cases and explicit refusals; editor acceptance is specific to the synthetic
fixtures, macOS Apple Silicon, Kdenlive 26.08.2 and MLT 7.43.0.

| Area | Automated validation | Recorded native editor validation |
| --- | --- | --- |
| MCP lifecycle | Seven-tool discovery, open/info/validate, edit/import, Save As, close, schemas and errors; in-memory client and separate CLI process | The saved outputs described below were opened/saved separately |
| Range removal | Disjoint cuts, blank/clip boundaries, unchanged other populated track, duration and source ranges | Three one-second cuts: timeline 250 → 175 frames; Kdenlive Save As retained all four resulting clip ranges |
| Splitting | Duration/source continuity, preservation and invalid offsets | Used in the audio and music workflows below; no separate exhaustive editor matrix |
| Clip volume/fades | Shared-source isolation, gain/fade limits, replacing/removing stacks, recognition of a native-saved managed stack | Editable Volume/Fade in/Fade out retained after Save As; generated/native audio measurements match |
| Bin audio insertion/replacement | Empty track, blank fill, append, overlap refusal, source bounds, replacement and sequential insert/replace | Saved clip/source ranges retained; 440/880 Hz measurements confirm the intended overlap and replacement |
| WAV import | PCM16 mono/stereo, headers/chunks, duration flooring, duplicate paths/aliases, unique IDs, preservation, rollback and busy sessions | Imported synthetic 880 Hz WAV retained in the bin with 250-frame duration after Kdenlive Save As; insertion/replacement measured |
| XML preservation and transactions | Original bytes outside patches, comments/entities/CDATA/Unicode, unique IDs/references, full batch rollback, stale revisions and unsupported layouts | Native saves establish acceptance of these fixtures; the editor itself rewrites XML |
| Files and sessions | Allowed roots/symlinks, missing/forbidden media, UTF-8/size/session limits, changed original, exclusive save and racing saves | Native output can be reopened within the documented fixture scope |

Measured acceptance results:

- Cut rendering contains exactly **250 frames before and 175 after**, with audio.
- In the volume/fade fixture, the unchanged section has RMS ratio **1**, the
  -6 dB section approximately **0.501227**, and the fade windows approximately
  **0.024111 / 0.043613**. Native-saved and generated audio match.
- Music/import measurements detect 440 Hz before insertion, 440/880 Hz during
  overlap and 880 Hz after replacement. The original project and imported WAV
  remain unchanged; generated output lasts **250 frames / 10 seconds**.
- Kdenlive Save As adds **one wrapper frame** in the documented audio/music
  fixture, also observed in an unedited native control: the native render lasts
  **10.04 seconds** while clip ranges still end at frame 250. This is a known
  evidence limit, not proof of correct durations for arbitrary projects.

Rendering through MLT and opening/saving through the editor are separate checks.
The scripts do not automate the GUI. Full provenance, native copy paths and
reports are recorded in [verification evidence](docs/verification.md) and
[fixture provenance](tests/fixtures/README.md); local `.artifacts/` reports are
not distributed with the repository.

## Compatibility and limits

- Editing currently supports document version `1.1`, one sequence, two playlists
  per track and at most one occupied playlist on the affected track.
- Groups, mixes, user transitions, unknown affected effects, nested sequences,
  locked tracks and unmodeled track timing are explicitly refused.
- Unrelated XML spans remain unchanged, including unknown properties and editor
  metadata. This does not prove compatibility with every Kdenlive feature.
- Files must be UTF-8 and at most 16 MiB. The XML parser is bounded to 128 levels
  and 200,000 nodes and refuses DTDs, duplicate IDs and broken modeled references.
  There are at most 32 open sessions.
- Saving requires recognized local media within allowed roots. Relative media
  require an absolute XML `root`; ambiguous relative roots are refused.
- The original is retained. Saving checks for external source changes, writes a
  synced temporary file and publishes it with an exclusive hard link. The file
  system must support hard links. Directory durability across power loss and
  hostile concurrent directory replacement are outside this initial guarantee.
- A cleanup error can be reported after publication; inspect the destination
  before retrying. Existing files are always refused.
- Media validation checks paths, not decodability or codec compatibility.
- Importing formats beyond the WAV subset above, arbitrary effects, render jobs
  over MCP and live editor control are not implemented yet. Temporal cuts refuse
  affected clip effects; replacement requires an effect-free target.
- Linux and Windows native editor compatibility has not been verified.
- Creating projects from scratch, video import, dedicated video/effect/transition
  operations, multiple-sequence editing and automatic narration generation are
  not implemented. Generic playlist cut tests are not native video acceptance.

## Verification and development

```sh
pnpm check        # Type checking, 105 tests in seven suites, build
pnpm test:stdio   # Real child-process MCP lifecycle
pnpm test:native  # Render a trusted synthetic fixture through installed MLT
pnpm test:audio   # Measure volume and fades in rendered audio
pnpm test:music   # Import a second tone; measure insertion and replacement
```

Native acceptance requires Kdenlive/MLT and `ffprobe`. On macOS the default MLT
path is `/Applications/kdenlive.app/Contents/MacOS/melt`; elsewhere it is `melt`.
Override melt with `MELT_PATH`; the video script also accepts `FFPROBE_PATH`.
Scripts write projects, rendered media, logs and reports under `.artifacts/`.
To measure a previously saved native import copy, run
`pnpm test:music /absolute/path/to/import-roundtrip.kdenlive`. Reopening the
copy in Kdenlive is a separate manual check. Normal tests do not require Kdenlive.

During this README update on 2026-10-15, `check` (105 tests, type checking and
build), `test:stdio`, `test:native`, `test:audio` and `test:music` all passed.
The music run measured the previously native-saved import copy documented in
[verification evidence](docs/verification.md). No new GUI open/save was performed.

The CI workflow configures Ubuntu/macOS with Node.js 24 for `check` and
`test:stdio`; the recorded evidence is local, with no confirmed remote CI run.

- [Research and alternatives](docs/research.md)
- [Design and scope](docs/design.md)
- [Implementation checklist](docs/implementation-plan.md)
- [Verification evidence](docs/verification.md)
- [Fixture provenance](tests/fixtures/README.md)
- [Repository-local preferred skills](.agents/skills/README.md)

`src/core` owns XML inspection and editing, `src/io` owns sessions and files, and
`src/mcp` adapts these operations to MCP. Keep editor-specific policies in the
core rather than duplicating them in tool handlers. Add regression tests before
expanding accepted project structures, then verify new behavior in the editor.

The project code is MIT licensed; repository-local skill copies retain their
own source terms and are excluded from the project license grant.
