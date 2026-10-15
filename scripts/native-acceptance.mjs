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
const artifacts = resolve(".artifacts");
await mkdir(artifacts, { recursive: true });
const folder = await mkdtemp(join(artifacts, "native-"));
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
const edited = workspace.apply(sessionId, 0, [
  {
    type: "remove_ranges",
    trackId: "tractor1",
    ranges: [
      { start: 25, end: 50 },
      { start: 100, end: 125 },
      { start: 175, end: 200 },
    ],
  },
]);
await workspace.saveAs(sessionId, 1, join(folder, "edited.kdenlive"));
const melt =
  process.env.MELT_PATH ??
  (process.platform === "darwin"
    ? "/Applications/kdenlive.app/Contents/MacOS/melt"
    : "melt");
const results = [];
for (const name of ["original", "edited"]) {
  const { stderr } = await execute(
    melt,
    [
      join(folder, `${name}.kdenlive`),
      "-consumer",
      `avformat:${join(folder, `${name}.mp4`)}`,
      "vcodec=libx264",
      "acodec=aac",
      "crf=30",
      "preset=ultrafast",
      "real_time=-1",
      "threads=2",
    ],
    {
      cwd: folder,
      env: { ...process.env, QT_QPA_PLATFORM: "offscreen" },
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  await writeFile(join(folder, `${name}-melt.log`), stderr);
  const { stdout } = await execute(
    process.env.FFPROBE_PATH ?? "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      join(folder, `${name}.mp4`),
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const probe = JSON.parse(stdout),
    video = probe.streams.find((s) => s.codec_type === "video");
  const expected = name === "original" ? 250 : 175;
  if (Number(video?.nb_read_frames) !== expected)
    throw new Error(
      `${name}: expected ${expected} frames, got ${video?.nb_read_frames}`,
    );
  if (!probe.streams.some((s) => s.codec_type === "audio"))
    throw new Error(`${name}: missing audio stream`);
  results.push({
    name,
    frames: Number(video.nb_read_frames),
    duration: probe.format.duration,
    audio: true,
  });
}
if ((await readFile(join(folder, "original.kdenlive"), "utf8")) !== source)
  throw new Error("Original was modified");
const report = {
  folder,
  melt,
  expectedEditedFrames: edited.duration,
  results,
  guiReopen: "Must be verified separately",
};
await writeFile(
  join(folder, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
