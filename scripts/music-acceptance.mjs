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
import { randomUUID } from "node:crypto";
import { Workspace, Project } from "../dist/index.js";
import { parseXml, raw, escapeXml } from "../dist/core/xml.js";
import { pcm } from "./pcm.mjs";

const execute = promisify(execFile);
await mkdir(".artifacts", { recursive: true });
const folder = await mkdtemp(resolve(".artifacts/music-"));
await copyFile("tests/fixtures/tone.wav", join(folder, "tone.wav"));
// Original synthetic 880 Hz media distinguishes music from the 440 Hz narration.
const wave = Buffer.from(await readFile("tests/fixtures/tone.wav"));
const audio = pcm(wave);
for (let i = 0; i < audio.samples.length / 2; i++)
  audio.samples.writeInt16LE(
    Math.round(4000 * Math.sin((2 * Math.PI * 880 * i) / audio.rate)),
    i * 2,
  );
await writeFile(join(folder, "music.wav"), wave);
let source = (
  await readFile("tests/fixtures/native-26.08.2.kdenlive", "utf8")
).replace('root="."', `root="${escapeXml(folder)}"`);
const doc = parseXml(source);
let music = raw(doc, doc.ids.get("chain1"))
  .replace('id="chain1"', 'id="music_bin"')
  .replace('name="kdenlive:id">4<', 'name="kdenlive:id">5<')
  .replaceAll("tone.wav", "music.wav")
  .replace(
    /(<property name="kdenlive:control_uuid">).*?(<\/property>)/,
    `$1{${randomUUID()}}$2`,
  )
  .replace(/\s*<property name="kdenlive:file_hash">.*?<\/property>/, "");
source = source.replace(
  '<playlist id="main_bin">',
  `${music}\n<playlist id="main_bin"><entry producer="music_bin" in="0" out="249"/>`,
);
await writeFile(join(folder, "original.kdenlive"), source);
const workspace = await Workspace.create([folder]);
const { sessionId } = await workspace.open(join(folder, "original.kdenlive"));
workspace.apply(sessionId, 0, [
  { type: "split_clip", clipId: "playlist2:0", offset: 125 },
]);
workspace.apply(sessionId, 1, [
  {
    type: "insert_audio_clip",
    trackId: "tractor0",
    sourceId: "music_bin",
    at: 25,
    sourceIn: 0,
    sourceOut: 100,
  },
  {
    type: "replace_audio_clip",
    clipId: "playlist2:1",
    sourceId: "music_bin",
    sourceIn: 125,
  },
]);
await workspace.saveAs(sessionId, 2, join(folder, "music.kdenlive"));
const melt =
  process.env.MELT_PATH ??
  (process.platform === "darwin"
    ? "/Applications/kdenlive.app/Contents/MacOS/melt"
    : "melt");
const projects = {
  original: join(folder, "original.kdenlive"),
  music: join(folder, "music.kdenlive"),
};
if (process.argv[2]) {
  projects.roundtrip = resolve(process.argv[2]);
  const info = new Project(await readFile(projects.roundtrip, "utf8")).info();
  const tracks = info.tracks
    .filter((t) => t.clips.length)
    .map((t) => t.clips.map((c) => [c.start, c.end, c.sourceIn, c.sourceOut]));
  assert.deepEqual(
    tracks,
    [
      [[25, 125, 0, 100]],
      [
        [0, 125, 0, 125],
        [125, 250, 125, 250],
      ],
    ],
    "Native save must retain all timeline/source ranges",
  );
}
function amplitude(audio, frequency, start, end) {
  let real = 0,
    imaginary = 0;
  const first = Math.round(start * audio.rate),
    last = Math.round(end * audio.rate);
  assert.ok(last * 2 <= audio.samples.length);
  for (let i = first; i < last; i++) {
    const value = audio.samples.readInt16LE(i * 2) / 32768,
      phase = (2 * Math.PI * frequency * i) / audio.rate;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return (2 * Math.hypot(real, imaginary)) / (last - first);
}
const results = {};
for (const [name, path] of Object.entries(projects)) {
  const output = join(folder, `rendered-${name}.wav`);
  const { stderr } = await execute(
    melt,
    [
      path,
      "-consumer",
      `avformat:${output}`,
      "vn=1",
      "acodec=pcm_s16le",
      "ar=8000",
      "ac=1",
      "real_time=-1",
    ],
    {
      env: { ...process.env, QT_QPA_PLATFORM: "offscreen" },
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  await writeFile(join(folder, `${name}-melt.log`), stderr);
  const rendered = pcm(await readFile(output));
  results[name] = {
    duration: rendered.samples.length / 2 / rendered.rate,
    windows: [
      [0.2, 0.8],
      [2, 3],
      [7, 8],
    ].map(([start, end]) => ({
      narration: amplitude(rendered, 440, start, end),
      music: amplitude(rendered, 880, start, end),
    })),
  };
  if (name !== "roundtrip") assert.equal(results[name].duration, 10);
  else
    assert.equal(
      results[name].duration,
      10.04,
      "Known native one-frame extension also observed in the unedited control; see verification.md",
    );
}
const baseline = results.original.windows[0].narration;
for (const name of Object.keys(results).filter((n) => n !== "original")) {
  const [before, mixed, replaced] = results[name].windows;
  assert.ok(
    Math.abs(before.narration / baseline - 1) < 0.01 && before.music < 0.001,
    JSON.stringify(results[name]),
  );
  assert.ok(
    Math.abs(mixed.narration / baseline - 1) < 0.01 && mixed.music > 0.1,
    JSON.stringify(results[name]),
  );
  assert.ok(
    replaced.narration < 0.001 && replaced.music > 0.1,
    JSON.stringify(results[name]),
  );
}
assert.equal(await readFile(join(folder, "original.kdenlive"), "utf8"), source);
assert.deepEqual(
  await readFile(join(folder, "music.wav")),
  wave,
  "Rendering must not overwrite source media",
);
const report = {
  folder,
  melt,
  results,
  guiReopen: process.argv[2] ? "native-saved copy measured" : "pending",
};
await writeFile(
  join(folder, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
