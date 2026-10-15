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

| Tool | Purpose |
| --- | --- |
| `project_open` | Open a saved project and return a session, revision, tracks, clips and media |
| `project_info` | Inspect the current in-memory revision |
| `project_validate` | Check recognized media paths and their availability |
| `project_import_audio` | Add a local PCM16 WAV reference to the bin and return its source ID and duration |
| `timeline_apply` | Apply revision-checked cuts, audio settings or music edits |
| `project_save_as` | Save to a new sibling `.kdenlive` without overwriting any file |
| `project_close` | Release a session, discarding unsaved in-memory changes |

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

## Compatibility and limits

- Editing currently supports document version `1.1`, one sequence, two playlists
  per track and at most one occupied playlist on the affected track.
- Groups, mixes, user transitions, unknown affected effects, nested sequences,
  locked tracks and unmodeled track timing are explicitly refused.
- Unrelated XML spans remain unchanged, including unknown properties and editor
  metadata. This does not prove compatibility with every Kdenlive feature.
- Files must be UTF-8 and at most 16 MiB. There are at most 32 open sessions.
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
