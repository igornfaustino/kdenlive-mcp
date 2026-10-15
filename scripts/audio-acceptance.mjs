import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Workspace } from "../dist/index.js";

const execute = promisify(execFile);
await mkdir(".artifacts", { recursive: true });
const folder = await mkdtemp(resolve(".artifacts/audio-"));
await copyFile("tests/fixtures/tone.wav", join(folder, "tone.wav"));
const source = (
  await readFile("tests/fixtures/native-26.08.2.kdenlive", "utf8")
).replace(
  'root="."',
  `root="${folder.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`,
);
await writeFile(join(folder, "original.kdenlive"), source);
const workspace = await Workspace.create([folder]);
const { sessionId } = await workspace.open(join(folder, "original.kdenlive"));
workspace.apply(sessionId, 0, [
  { type: "split_clip", clipId: "playlist2:0", offset: 125 },
]);
workspace.apply(sessionId, 1, [
  {
    type: "set_clip_audio",
    clipId: "playlist2:1",
    gainDb: -6,
    fadeInFrames: 25,
    fadeOutFrames: 25,
  },
]);
await workspace.saveAs(sessionId, 2, join(folder, "audio.kdenlive"));
const melt =
  process.env.MELT_PATH ??
  (process.platform === "darwin"
    ? "/Applications/kdenlive.app/Contents/MacOS/melt"
    : "melt");

function pcm(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  let samples, rate;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const name = buffer.toString("ascii", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4);
    if (name === "fmt ") {
      assert.equal(buffer.readUInt16LE(offset + 8), 1, "PCM format");
      assert.equal(buffer.readUInt16LE(offset + 10), 1, "mono");
      assert.equal(buffer.readUInt16LE(offset + 22), 16, "16-bit");
      rate = buffer.readUInt32LE(offset + 12);
    }
    if (name === "data")
      samples = buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(samples && rate);
  return { samples, rate };
}
function rms(audio, start, end) {
  let squares = 0;
  const first = Math.round(start * audio.rate),
    last = Math.round(end * audio.rate);
  assert.ok(last * 2 <= audio.samples.length);
  for (let i = first; i < last; i++)
    squares += (audio.samples.readInt16LE(i * 2) / 32768) ** 2;
  return Math.sqrt(squares / (last - first));
}
const rendered = {};
const projects = {
  original: join(folder, "original.kdenlive"),
  audio: join(folder, "audio.kdenlive"),
};
// The optional file is a copy saved by the native editor, for round-trip measurement.
if (process.argv[2]) {
  assert.ok(
    process.argv[3],
    "Provide the native-saved original control alongside the native-saved edited copy",
  );
  projects.roundtrip = resolve(process.argv[2]);
  projects.roundtripControl = resolve(process.argv[3]);
}
for (const [name, path] of Object.entries(projects)) {
  const { stderr } = await execute(
    melt,
    [
      path,
      "-consumer",
      `avformat:${join(folder, `${name}.wav`)}`,
      "vn=1",
      "acodec=pcm_s16le",
      "ar=8000",
      "ac=1",
      "real_time=-1",
    ],
    {
      env: { ...process.env, QT_QPA_PLATFORM: "offscreen" },
      cwd: folder,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  await writeFile(join(folder, `${name}-melt.log`), stderr);
  rendered[name] = pcm(await readFile(join(folder, `${name}.wav`)));
  if (name === "original" || name === "audio")
    assert.equal(
      rendered[name].samples.length / 2 / rendered[name].rate,
      10,
      "timeline duration",
    );
}
if (rendered.roundtrip)
  assert.equal(
    rendered.roundtrip.samples.length / rendered.roundtrip.rate,
    rendered.roundtripControl.samples.length / rendered.roundtripControl.rate,
    "Native edited duration must match the native control",
  );
const baseline = rms(rendered.original, 2, 3),
  measurements = {};
for (const name of Object.keys(rendered).filter(
  (name) => name !== "original" && name !== "roundtripControl",
)) {
  const audio = rendered[name];
  const levels = {
    unchanged: rms(audio, 2, 3) / baseline,
    steady: rms(audio, 7, 8) / baseline,
    fadeIn: rms(audio, 5.04, 5.12) / baseline,
    fadeOut: rms(audio, 9.88, 9.96) / baseline,
  };
  assert.ok(Math.abs(levels.unchanged - 1) < 0.002, JSON.stringify(levels));
  assert.ok(
    Math.abs(levels.steady - 10 ** (-6 / 20)) < 0.01,
    JSON.stringify(levels),
  );
  assert.ok(
    levels.fadeIn < 0.1 && levels.fadeOut < 0.1,
    JSON.stringify(levels),
  );
  measurements[name] = levels;
}
assert.equal(await readFile(join(folder, "original.kdenlive"), "utf8"), source);
const report = {
  folder,
  melt,
  durationSeconds: 10,
  nativeDurationSeconds: rendered.roundtrip
    ? rendered.roundtrip.samples.length / 2 / rendered.roundtrip.rate
    : undefined,
  gainDb: -6,
  fadeFrames: 25,
  measurements,
};
await writeFile(
  join(folder, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
