# Verification — updated 2026-10-15

## Automated checks

Local environment: macOS Apple Silicon, Node.js 24.18.1, pnpm 11.17.0,
Kdenlive 26.08.2, bundled MLT 7.43.0.

- `pnpm check`: strict TypeScript checking (including unused symbols), 71 tests
  in five suites, and production build.
- `pnpm test:stdio`: the official MCP client launches the compiled CLI as a
  separate process. Discovery returns six tools; opening, removing a range,
  audio settings, music insertion/replacement, validation, exclusive save and close
  complete successfully. Original bytes
  remain unchanged.
- `pnpm test:native`: render the original and edited native fixture with the
  installed Kdenlive MLT, then inspect the output using ffprobe. Both contain
  audio; frame counts are exactly 250 and 175 at 25 fps.

Tests cover byte-preserving no-op inspection, unchanged XML outside edits,
three disjoint removals, splitting, blank/clip boundaries, another populated
track, integer/rational time conversion, batch rollback, stale revisions,
malformed XML, DTDs, duplicate IDs, broken references, unknown versions, groups,
unmodeled timing and sequence sources, path containment, symlink escapes,
external modifications, missing/forbidden media, ambiguous roots, session limits,
UTF-8/size limits, concurrent exclusive saves and MCP errors.

The two populated-track and gap tests synthesize structural variants of the
native fixture; they are unit checks, not a native video acceptance claim.

## Native editor acceptance

The fixture was created in the stock Kdenlive app using an original synthetic
10-second tone. Three one-second ranges were removed from A1:
`[25,50)`, `[100,125)` and `[175,200)`.

The edited copy was opened in Kdenlive without a missing-media dialog. The
visible timeline contained four audio segments on A1 and displayed `00:00:07:00`.
A further **Save As** from Kdenlive produced `roundtrip.kdenlive`; parsing that
native save confirmed a total of 175 frames and these exact ranges:

| Timeline frames | Source frames |
| --- | --- |
| [0,25) | [0,25) |
| [25,75) | [50,100) |
| [75,125) | [125,175) |
| [125,175) | [200,250) |

Local artifacts from this GUI round trip are in `.artifacts/native-yFTrop/`.
A later render run is in `.artifacts/native-DsDhHn/`; each run contains a JSON
report, both project files, both videos and renderer logs. Artifacts are ignored
by version control. The reported MP4 container durations were 10.005 and 7.018
seconds because of audio encoding padding; exact video frame counts establish
the intended timeline duration. The script deliberately leaves `guiReopen` as a
manual check instead of asserting that a render proves editor compatibility.

## Findings fixed

- `src/core/xml.ts` — scan complete quoted attributes before replacing a value;
  attribute-like text inside an unknown attribute no longer corrupts timing.
- `src/core/editing.ts` — reject trimmed references and nonzero tractor starts
  whose timing is not represented by the model.
- `src/core/editing.ts` — reject direct sequence sources outside modeled tracks
  and the recognized native background producer.
- `src/io/workspace.ts` — propagate temporary-file cleanup errors other than an
  already-absent file, instead of silently swallowing all failures.
- `src/core/editing.ts`, `src/io/workspace.ts`, `tsconfig.json` — remove unused
  imports and enable compiler checks against unused symbols.

clean-code-guard: 5 fixed, 0 flagged for author

The independent review identified the first two issues before its final pass
was interrupted by an account usage limit. Regression tests reproduced both
failures before their fixes. Local review and executable checks continued.

An additional native acceptance discovery: with relative media, XML `root="."`
can resolve against the editor process directory. The portable fixture is now
materialized with an absolute root for native tests; production saving refuses
ambiguous roots rather than claiming media resolution is safe.

## Limits of this evidence

This validates the first preservation experiment, not the entire proposed MVP.
There is no native acceptance yet for video, user effects/transitions,
multiple sequences, or Windows/Linux editor builds. The CI workflow is prepared for macOS and Linux unit/stdio checks but has
not been run on GitHub. Git was initialized and local commits are now maintained. No remote publication
or package release was made.

## Clip audio and music acceptance

Volume and fades are attached to timeline entries, preserving other instances
of the same media. A native Save As retains the editable Volume, Fade in and
Fade out stack. The checked-in `native-audio-26.08.2.kdenlive` fixture captures
that native output with portable paths.

`pnpm test:audio` measures a split 10-second synthetic tone. The unchanged half
has RMS ratio 1; the -6 dB section measures 0.501227; the fade windows measure
0.024111 and 0.043613. Generated and native-saved audio match. Native evidence:
`.artifacts/audio-AqzLF8/report.json`; a later generated-output check is in
`.artifacts/audio-RTnh0C/report.json`.

`pnpm test:music` constructs a second original 880 Hz tone alongside the 440 Hz
fixture. It inserts music at frames [25,125) on A2 and replaces [125,250) on A1.
Spectral measurements confirm narration alone before insertion, both frequencies
in the overlap, and music alone in the replaced section. Original project bytes
remain unchanged and generated duration is exactly 250 frames (10 seconds).

The generated project was opened in Kdenlive and saved as
`.artifacts/music-0NjOjb/music-roundtrip.kdenlive`. Parsing the native save checks
all three timeline/source ranges. Rendering it reproduces the same measured
frequency amplitudes, about 0.12206 for each active tone. Evidence is in
`.artifacts/music-njnRro/report.json`. These synthetic tests validate existing-bin
audio operations, not arbitrary media import or codec compatibility.

Native Save As adds one frame to this fixture's sequence/wrapper duration:
rendered output becomes 10.04 seconds while clip ranges still end at frame 250.
The same extra frame occurs after saving the unedited original in Kdenlive;
`audio-acceptance.mjs` compares the native edited copy against that native control.
The music round-trip check explicitly asserts this observed duration rather than
silently accepting arbitrary duration changes. This remains a fixture/editor
compatibility limitation, not a claim of byte-preserving native saves.

The sequential MCP acceptance exposed a parser boundary bug when adjacent closing
tags have no whitespace. The parser now excludes the following tag from its
closing-span lookup. A regression inserts and then replaces the same clip.
Replacement also refuses source links and identity comments that would otherwise
be discarded; both protections have regression tests.
