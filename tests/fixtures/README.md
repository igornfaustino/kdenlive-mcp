# Native fixture provenance

`native-26.08.2.kdenlive` was created and saved in the official Kdenlive 26.08.2
macOS application on 2026-10-14, with HD 1080p25, the default four tracks and a
10-second synthetic tone inserted at frame zero of A1. The XML root path was
normalized from the developer's absolute fixture folder to `.` for portability.
The editor file-browser location was also replaced with `.` to remove a personal
path; all remaining XML was retained. `tone.wav` is an original generated 440 Hz sine,
8 kHz mono PCM16; no user media or third-party fixture is included.

This fixture exercises native mixer filters and internal transitions, but does
not represent acceptance of user-authored clip effects, compositions or video.

Before native use, materialize the XML `root` as the absolute fixture directory.
The acceptance script does this automatically. Kdenlive may interpret `root="."`
relative to its process directory rather than the project location.

`native-audio-26.08.2.kdenlive` was generated from the base fixture by splitting
at frame 125 and applying -6 dB plus 25-frame fades only to the second entry.
It was opened and saved as a new copy in stock Kdenlive 26.08.2. Root and browser
paths were normalized to `.`. This captures native clock serialization and MLT
default properties, including the observed native wrapper duration behavior
recorded in `docs/verification.md`. Both entries still total 250 frames.
