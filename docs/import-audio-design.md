# Local audio import — 2026-10-15

Goal: import a new local WAV into the existing project bin, then use the existing
music operations. Add `project_import_audio(sessionId,expectedRevision,path)`.
Return sourceId, durationFrames, and updated project information. Import adds a
reference; it never copies, rewrites or transcodes media. Save As remains explicit.

Use bounded RIFF inspection rather than trusting caller duration or requiring
ffprobe. Initially accept classic little-endian WAV PCM16 mono/stereo, positive
sample rate, consistent byte rate/block alignment and one nonempty data chunk.
Seek over payloads, limit chunk count, reject truncated/duplicate/unsupported
structures and files that change during inspection. Duration is floor(sample
count * project fps / sample rate), conservatively excluding partial frames.
Reference: https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff-

Workspace enforces canonical allowed roots and regular files before inspection.
Hold the session busy across asynchronous inspection; reject stale revisions
before work, release on failure, and leave XML/revision unchanged on errors.
Core receives validated media facts, allocates unused XML/bin IDs, adds an
avformat chain before main_bin and an entry inside main_bin. Keep all existing
XML spans, bin entries and timeline timing unchanged. Resource is absolute and
XML escaped. Only version 1.1 single-sequence layouts are supported initially.
Duplicate paths are rejected; importing through canonical paths makes repeated
imports unambiguous. Existing relative references use an absolute XML root.

Implementation plan:
- [x] Failing tests for RIFF boundaries, metadata chunks, formats and durations;
      implement src/io/wave.ts without loading audio payloads.
- [x] Failing core/workspace tests for preservation, collisions, invalid paths,
      rollback and busy sessions; implement core import and Workspace method.
- [x] Expose MCP tool; test stdio import -> replace -> save and existing-bin
      insertion; test import -> insert -> save in Workspace integration.
- [x] Native render and Kdenlive Save As acceptance using a newly imported tone.
- [x] Update README/evidence and commit verified increments.

Implementation: `659fdf2`; FourCC correction: `d992ca7`; real-import music
acceptance: `329d243`. The native copy retained its imported bin entry, 250-frame
source duration and timeline ranges. The known one-frame wrapper extension also
occurs in the unedited native control. See [verification](verification.md) for
the separate automated and native evidence; no general codec support is implied.

General codecs via ffprobe are deferred to keep this first import dependency-free.
Calling native Kdenlive import would require a running editor and a separate live
control architecture; it is outside this saved-project server.
