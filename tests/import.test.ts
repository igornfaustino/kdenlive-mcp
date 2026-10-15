import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { inspectWave } from "../src/io/wave.js";
import { Workspace } from "../src/io/workspace.js";
const template = await readFile(
  new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
  "utf8",
);
const tone = await readFile(new URL("./fixtures/tone.wav", import.meta.url));
let root: string, path: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "kdenlive-import-")));
  path = join(root, "music & new.wav");
  await writeFile(path, tone);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("inspects PCM without guessing duration from file size", async () => {
  expect(await inspectWave(path)).toMatchObject({
    samples: 80000,
    sampleRate: 8000,
    channels: 1,
  });
  const metadata = Buffer.from("JUNK\x03\x00\x00\x00abc\x00", "binary");
  const wave = Buffer.concat([
    tone.subarray(0, 12),
    metadata,
    tone.subarray(12),
  ]);
  wave.writeUInt32LE(wave.length - 8, 4);
  await writeFile(path, wave);
  expect(await inspectWave(path)).toMatchObject({
    samples: 80000,
    sampleRate: 8000,
  });
});
it.each([
  "truncated",
  "float",
  "channels",
  "alignment",
  "rate",
  "empty",
  "duplicate",
])("rejects %s WAV", async (kind) => {
  let data = Buffer.from(tone);
  if (kind === "truncated") data = data.subarray(0, data.length - 1);
  if (kind === "float") data.writeUInt16LE(3, 20);
  if (kind === "channels") data.writeUInt16LE(3, 22);
  if (kind === "alignment") data.writeUInt16LE(4, 32);
  if (kind === "rate") data.writeUInt32LE(1, 28);
  if (kind === "empty") {
    data = data.subarray(0, 44);
    data.writeUInt32LE(36, 4);
    data.writeUInt32LE(0, 40);
  }
  if (kind === "duplicate") {
    data = Buffer.concat([data, tone.subarray(12, 36)]);
    data.writeUInt32LE(data.length - 8, 4);
  }
  await writeFile(path, data);
  await expect(inspectWave(path)).rejects.toThrow();
});
async function session() {
  const input = join(root, "original.kdenlive");
  await writeFile(input, template.replace('root="."', `root="${root}"`));
  await writeFile(join(root, "tone.wav"), tone);
  const workspace = await Workspace.create([root]);
  const { sessionId } = await workspace.open(input);
  return { workspace, sessionId, input };
}
it("imports, inserts and saves without modifying existing XML or media", async () => {
  const { workspace, sessionId, input } = await session();
  const original = await readFile(input, "utf8");
  const imported = await workspace.importAudio(sessionId, 0, path);
  expect(imported.revision).toBe(1);
  expect(imported.durationFrames).toBe(250);
  expect(imported.media.find((m) => m.id === imported.sourceId)).toMatchObject({
    resource: path,
    inProjectBin: true,
  });
  workspace.apply(sessionId, 1, [
    {
      type: "insert_audio_clip",
      trackId: "tractor0",
      sourceId: imported.sourceId,
      at: 25,
      sourceIn: 0,
      sourceOut: 100,
    },
  ]);
  await workspace.saveAs(sessionId, 2, join(root, "edited.kdenlive"));
  expect(await readFile(input, "utf8")).toBe(original);
  expect(await readFile(path)).toEqual(tone);
  await expect(workspace.importAudio(sessionId, 2, path)).rejects.toThrow(
    /already|duplicate/i,
  );
  expect(workspace.info(sessionId).revision).toBe(2);
});
it("rejects stale revisions, invalid media and root escapes without advancing revision", async () => {
  const { workspace, sessionId } = await session();
  await expect(workspace.importAudio(sessionId, 1, path)).rejects.toThrow(
    /revision/i,
  );
  await writeFile(path, "not audio");
  await expect(workspace.importAudio(sessionId, 0, path)).rejects.toThrow();
  await symlink("/etc/hosts", join(root, "escape.wav"));
  await expect(
    workspace.importAudio(sessionId, 0, join(root, "escape.wav")),
  ).rejects.toThrow(/root/i);
  expect(workspace.info(sessionId).revision).toBe(0);
});
it("locks the session until import completes and releases it afterward", async () => {
  const { workspace, sessionId } = await session();
  const pending = workspace.importAudio(sessionId, 0, path);
  expect(() => workspace.close(sessionId)).toThrow(/busy|progress/i);
  await expect(workspace.importAudio(sessionId, 0, path)).rejects.toThrow(
    /busy|progress/i,
  );
  await pending;
  expect(workspace.close(sessionId)).toEqual({ closed: true });
});
it("preserves existing root children and allocates distinct bin identities", async () => {
  const { workspace, sessionId, input } = await session();
  const first = await workspace.importAudio(sessionId, 0, path);
  const next = join(root, "second.wav");
  await writeFile(next, tone);
  const second = await workspace.importAudio(sessionId, 1, next);
  expect(first.sourceId).not.toBe(second.sourceId);
  expect(
    new Set(second.media.filter((m) => m.inProjectBin).map((m) => m.binId))
      .size,
  ).toBe(3);
  await workspace.saveAs(sessionId, 2, join(root, "imported.kdenlive"));
  const { parseXml, raw } = await import("../src/core/xml.js");
  const before = parseXml(await readFile(input, "utf8")),
    after = parseXml(await readFile(join(root, "imported.kdenlive"), "utf8"));
  for (const node of before.root.children.filter(
    (n) => n.attributes.id && n.attributes.id !== "main_bin",
  ))
    expect(raw(after, after.ids.get(node.attributes.id!)!)).toBe(
      raw(before, node),
    );
});
it("rejects aliases of existing bin media", async () => {
  const { workspace, sessionId } = await session();
  const alias = join(root, "alias.wav");
  await symlink(join(root, "tone.wav"), alias);
  await expect(workspace.importAudio(sessionId, 0, alias)).rejects.toThrow(
    /already/i,
  );
});
it("imports stereo without accepting sub-frame media", async () => {
  const { workspace, sessionId } = await session();
  const stereo = Buffer.from(tone);
  stereo.writeUInt16LE(2, 22);
  stereo.writeUInt32LE(32000, 28);
  stereo.writeUInt16LE(4, 32);
  await writeFile(path, stereo);
  expect((await workspace.importAudio(sessionId, 0, path)).durationFrames).toBe(
    125,
  );
  const small = Buffer.from(tone.subarray(0, 46));
  small.writeUInt32LE(38, 4);
  small.writeUInt32LE(2, 40);
  const short = join(root, "short.wav");
  await writeFile(short, small);
  await expect(workspace.importAudio(sessionId, 1, short)).rejects.toThrow(
    /frame/i,
  );
  expect(workspace.info(sessionId).revision).toBe(1);
});
