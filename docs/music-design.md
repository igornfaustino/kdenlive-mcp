# Existing-bin music placement

Extend timeline_apply with insert_audio_clip(trackId,sourceId,at,sourceIn,sourceOut)
and replace_audio_clip(clipId,sourceId,sourceIn). Select an audio-only source already
listed in main_bin. Importing new media from disk is a later I/O capability.

Insertion occupies blank space or appends with an explicit gap. It never moves
other clips and rejects overlaps. Replacement retains the target duration and
position; reject effect-bearing target entries until effect retiming is validated.
Reject invalid source ranges, non-audio tracks, bin effects, nested sequences,
locked tracks and mixes through existing checks. Keep unknown entry properties.

MLT resolves producer references as it streams XML. Bin definitions can follow
timeline playlists, so copy the selected bin source to a fresh timeline service
ID before the destination playlist, retaining bin identity and the original
source definition. Keep all other timeline/bin objects unchanged. Update affected
track and sequence duration fields only after insertion changes track content.

Tests: empty tracks, blank splitting, append gaps, collisions, source boundaries,
replacement identity/duration, XML ordering, unknown entry metadata, rollback.
Native acceptance: insert a second synthetic tone from the bin, replace a clip,
render and inspect frequency content and frame counts; reopen and save in Kdenlive.
