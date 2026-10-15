# Clip audio controls — 2026-10-14

Continue the approved preservation-first architecture with one `set_clip_audio`
operation: clipId, gainDb (-60..20), fadeInFrames and fadeOutFrames (zero disables).
Times are project frames. Fades must be zero or at least two frames; their sum
must not exceed clip duration. Explicitly set all three values on each request.

Attach filters directly to the selected playlist entry (the MLT cut), preserving
shared producers, bin identities and all other entries. The native experiment
showed parent-producer filters render but are not imported as clip effects by
Kdenlive. Entry filters are recognized as Volume, Fade in and Fade out.
Use `kdenlive_id`, source-coordinate in/out, `level` for dB volume and native
gain/end amplitude interpolation for fades. Fade-in bounds are
[sourceIn, sourceIn+N-1]; fade-out bounds are [sourceOut-N, sourceOut-1].

Reject pre-existing unrecognized source or entry filters. Reconfiguration only
replaces a fully recognized generated entry stack, with exact known properties,
shape and source timing; unknown added data must not be discarded. Zero values
remove generated effects. Audio edits on one entry leave effect-bearing neighbors
unchanged. Temporal cuts on effect-bearing tracks remain refused pending retiming.
Require an audio track and an avformat source configured with audio enabled and
video disabled. Existing layout, revision and atomic-save checks apply.

Use an operation dispatcher for existing and new operations. Separate layout
checks from temporal-edit effect restrictions, keeping timing operations equally
strict. Expose recognized audio settings in project inspection.

## Evidence

Installed Kdenlive 26.08.2 effect definitions: effects/volume.xml, fadein.xml,
fadeout.xml. Upstream EffectStackModel::importEffects selects `kdenlive_id`.
MLT normalize/filter_volume.yml and .c define level in dB and gain/end amplitude
interpolation. Context7 returned general property documentation; exact effect
behavior is checked against source and executable native rendering.

## Implementation and acceptance

1. Write failing tests for isolated shared producers, source-offset fades,
   replacement, invalid ranges, existing-effect rejection and rollback.
2. Add audio module and operation handler; expose schema through timeline_apply.
3. Render a split synthetic tone, applying -6 dB and fades only to the second
   clip; measure decoded PCM amplitude in unchanged, steady and faded sections.
4. Open generated output in Kdenlive, verify effects and save a native round trip.
5. Update usage, limitations and verification evidence. Music insertion and
   replacement remain the next separately validated extension.
