# Technical investigation — 2026-10-14

## Evidence and decision

The [official file-format description](https://github.com/KDE/kdenlive/blob/b23ffab560a866580c9a0d9c798c3c76dcfb3694/dev-docs/fileformat.md)
documents generation 5 (document version 1.1) and sequence tractors. Its XML
contains both rendering data and editor metadata. Rebuilding only the rendering
model does not establish that an existing edit remains intact.

The installed official macOS application reports Kdenlive **26.08.2**, with
bundled **MLT 7.43.0**, on this Apple Silicon machine. Its `--help` exposes project
opening, bin import and direct rendering, but no general timeline RPC interface.
This does not prove that every upstream internal interface is unavailable.

| Approach | Benefit | Main cost | Decision |
| --- | --- | --- | --- |
| Targeted edits of original XML | Official editor, portable, preserves unmodified source | Must understand affected editor metadata and reject unsafe edits | First experiment |
| Native MLT API/bindings | Established media graph and rendering | Native packaging; Kdenlive metadata is still separate | Rendering/validation adapter later |
| Patched Kdenlive API | In-editor operations, undo and live state | Fork/build distribution; platform and version coupling | Future optional adapter |

UI automation is useful for acceptance testing, not the production integration.

## Format and editing observations

1. **Project format / MLT relationship:** `.kdenlive` is MLT XML plus Kdenlive
   properties. Keep the whole original document, not a lossy canonical schema.
2. **Producers and chains:** describe source media or generators. The bin and
   timeline may contain separate services referring to the same media/bin ID.
3. **Playlists and tractors:** playlists order entries and blanks; tractors
   combine tracks. Current Kdenlive uses two playlists per editable track and a
   sequence tractor; the final project tractor wraps the active sequence.
4. **Identification:** XML service IDs resolve references within a document.
   `kdenlive:id` is a bin identity and is not a unique timeline instance ID.
   This implementation exposes revision-scoped playlist/entry handles.
5. **Cuts/trims/gaps:** MLT in/out are inclusive. The API uses half-open frame
   intervals. A cut retains the producer reference, changes in/out and introduces
   another entry. Removing a range on one track must not ripple other tracks.
6. **Transitions/mixes:** two occupied sub-playlists may encode same-track mixes.
   Reject editing those tracks initially. Internal always-active mixing is not
   equivalent to user-authored transitions. Reject user transitions during edits
   until their timing relationships are implemented.
7. **Effects/keyframes:** filters may attach to producers, tracks or sequences;
   animated properties are not plain scalar values. Preserve their source text.
   Refuse cuts on effect-bearing producers in this first experiment instead of
   claiming correct fade/keyframe retiming.
8. **Rendering:** [MLT XML](https://www.mltframework.org/docs/mltxml/) and the
   [melt CLI](https://www.mltframework.org/docs/melt/) support XML input and
   consumers. Use the app's bundled melt for the first real render; a valid XML
   parse alone is not acceptance evidence.
9. **macOS:** the installed app includes melt, kdenlive_render, MLT libraries and
   plugins. Executing bundled melt confirms this local runtime, not universal
   packaging compatibility. Linux/Windows require their own runtime tests.
10. **Official scripting:** inspection of upstream `src/main.cpp` and the local
    CLI did not establish a supported public timeline-editing RPC API. The fork
    described below must not be mistaken for functionality of stock Kdenlive.
11. **Version changes:** older format generations differ, notably sequence
    support in 23.04 onward. Restrict mutation to explicitly understood layouts
    and document version 1.1; do not perform automatic migrations.
12. **Unknown data:** strict SAX validation plus raw source ranges allows changes
    without whole-document serialization. Comments, whitespace, CDATA and
    unknown property values outside patches remain identical. Unknown semantics
    on edited objects still require conservative rejection.
13. **Broken references / missing media:** verify unique XML IDs and producer
    references; resolve recognized file-backed media relative to the XML root
    and project directory. Report missing, forbidden and unrecognized resources
    separately. Never treat a color generator as a file path.
14. **Concurrent editor changes:** hash the on-disk source when opening and
    before saving; reject changed contents. A new sibling output preserves the
    original and relative media context. Unsaved GUI state is not observable:
    the agent operates on the last saved file, not the live timeline.

MLT frame representation was cross-checked via Context7 against
`mltframework/mlt`'s `consumer_xml.c`, `producer_xml.c`, `mlt_property.c` and
`mlt_types.h`. Use rational FPS and integer frames; convert clock values with
integer arithmetic and explicit rounding. Do not infer drop-frame timecodes.

## Comparison projects and licenses

Source inspected on the following pinned revisions; no implementation copied.

- [AMMIROSOH](https://github.com/AMMIROSOH/Kdenlive-mcp/tree/b1ff6d5d0263c9074230b9a5d02a6a5d58d2386e):
  Apache-2.0. README, project creation and serialization source establish a
  versioned JSON source of truth, compiled MLT, revisions and rendering modules.
  Useful separation of responsibilities and conflict controls. Its JSON model
  is not evidence of lossless arbitrary native-project round trips.
- [jordantaylorfuller](https://github.com/jordantaylorfuller/kdenlive-mcp/tree/adfa86ad50703ed481bc08b010b56de065f22181):
  README and HTTP bridge require a modified Kdenlive build with scripting
  endpoints. Useful live-editing architecture, but a different deployment goal.
  No top-level license detected; embedded KDE code has its own licenses. Do not
  assume permission to reuse the bridge from the embedded KDE license.
- [Va1bhav512](https://github.com/Va1bhav512/kdenlive-mcp-server/tree/f1ce009ed5c800fbb92e5f2fdffb576b26d9d564):
  LICENSE states MIT, with vendor code retaining its upstream MIT notice.
  README and `core/project.py` open a `.kdenlive-cli.json` model and export XML.
  Many tools do not imply preservation of arbitrary imported native projects.

These are source observations, not exhaustive functional audits or legal advice.

## Smallest falsifiable experiment

Create a project in stock Kdenlive containing synthetic audio, retain the exact
native XML, open it in the library, remove three ranges, save a new sibling file,
and check that the unmodified XML remains intact. Reopen the result in the stock
editor and render using bundled MLT. Verify expected frame duration. Add fixtures
with real video, user effects/transitions and music before claiming the full MVP.

## Risks and follow-up

The largest risk is semantically stale editor metadata despite valid XML. Limit
mutation support, reject groups/mixes/nesting, and grow the fixture matrix first.
Other risks: timecode rounding, shared producer filters, render resource access,
symlink races, missing plugins and unsupported effect services. Atomic save-as
protects existing files but is not a sandbox against another hostile local
process changing directory symlinks during the final filesystem operations.

Repository layout: `src/core` (pure project engine), `src/io` (filesystem/session
boundary), `src/mcp` (tools), `tests/fixtures` (native input), `scripts` (real-runtime
acceptance), and `docs` (research, decisions, verification).
