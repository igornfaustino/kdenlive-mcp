# Existing-project editing: first implementation

The user explicitly requested implementation after the skills-only setup. This
increment validates the highest-priority architecture before expanding the API.

## Decision

Keep the original `.kdenlive` XML as the source of truth. Parse it strictly and
index source spans; replace only selected timeline entries and duration fields.
Unknown properties, comments, effect stacks, and unrelated tracks remain byte
identical. A standalone TypeScript library owns editing; MCP is a thin adapter.

Alternatives considered: a canonical JSON model plus regenerated XML loses
unknown editor metadata; a patched editor API improves live editing but requires
a fork; native MLT bindings add packaging complexity and do not by themselves
preserve Kdenlive editor metadata. See research.md for evidence and limitations.

## Initial boundary

Support document version 1.1, one sequence, simple playlists, integer frame
operations and rational FPS. Inspect projects before editing. First operations:
split an entry and remove specified timeline ranges on one track with ripple
confined to that track. Preserve media references. Refuse grouped clips, nested
sequences, mixes, locked tracks and affected clip effects until their semantics
are validated. Do not silently rewrite unsupported structures.

Each operation batch runs against an isolated string and commits only after
validation. Caller supplies the exact revision. Clip handles are revision-scoped
playlist/entry coordinates, not a promise about immutable Kdenlive IDs.

## Persistence and security

Require explicit allowed roots. Resolve symlinks and check path containment.
Reject DTDs and non-UTF-8 or oversized input. Detect external file modifications
with content hashes. Save only to a new sibling `.kdenlive` file, using a synced
temporary file and atomic exclusive publication; refuse overwrites. This avoids
silently changing relative media references. The original is the recovery point.
Never run processes described in a project. Rendering acceptance is an explicit
developer script against trusted synthetic fixtures and installed tools.

## Verification

Create a fixture in the installed official Kdenlive 26.08.2 using synthetic audio.
Test byte-identical no-op output, range edits, rational clocks, batch rollback,
stale revisions, forbidden paths, missing media and no-clobber saves. Exercise
MCP through the SDK client. Open the edited copy in Kdenlive and render with its
bundled MLT. Record exactly what was and was not verified.

This increment is not the complete narration/music/effects MVP. Clip-level
volume/fades, insertion/replacement, user transitions, multi-sequence editing and
render jobs remain separate increments after this preservation experiment.
