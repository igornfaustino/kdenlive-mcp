import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const folder = await mkdtemp(join(tmpdir(), "kdenlive-stdio-"));
const client = new Client({ name: "stdio-acceptance", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/cli.js"), "--root", folder],
});
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return response.structuredContent;
}
try {
  const escapedFolder = folder
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
  const source = (
    await readFile("tests/fixtures/native-26.08.2.kdenlive", "utf8")
  ).replace('root="."', `root="${escapedFolder}"`);
  const original = join(folder, "original.kdenlive");
  await writeFile(original, source);
  await copyFile("tests/fixtures/tone.wav", join(folder, "tone.wav"));
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 6);
  const { sessionId } = await call("project_open", { path: original });
  const edited = await call("timeline_apply", {
    sessionId,
    expectedRevision: 0,
    operations: [
      {
        type: "remove_ranges",
        trackId: "tractor1",
        ranges: [{ start: 25, end: 50 }],
      },
    ],
  });
  assert.equal(edited.duration, 225);
  assert.equal((await call("project_validate", { sessionId })).valid, true);
  const audio = await call("timeline_apply", {
    sessionId,
    expectedRevision: 1,
    operations: [
      {
        type: "set_clip_audio",
        clipId: "playlist2:1",
        gainDb: -9,
        fadeInFrames: 10,
        fadeOutFrames: 10,
      },
    ],
  });
  assert.equal(audio.revision, 2);
  assert.equal(
    audio.tracks.find((track) => track.id === "tractor1").clips[1].audio.gainDb,
    -9,
  );
  const music = await call("timeline_apply", {
    sessionId,
    expectedRevision: 2,
    operations: [
      {
        type: "insert_audio_clip",
        trackId: "tractor0",
        sourceId: "chain1",
        at: 25,
        sourceIn: 0,
        sourceOut: 100,
      },
    ],
  });
  assert.equal(
    music.tracks.find((t) => t.id === "tractor0").clips[0].start,
    25,
  );
  const replaced = await call("timeline_apply", {
    sessionId,
    expectedRevision: 3,
    operations: [
      {
        type: "replace_audio_clip",
        clipId: music.tracks.find((t) => t.id === "tractor0").clips[0].id,
        sourceId: "chain1",
        sourceIn: 50,
      },
    ],
  });
  assert.equal(
    replaced.tracks.find((t) => t.id === "tractor0").clips[0].sourceIn,
    50,
  );
  await call("project_save_as", {
    sessionId,
    expectedRevision: 4,
    path: join(folder, "edited.kdenlive"),
  });
  assert.equal(await readFile(original, "utf8"), source);
  assert.notEqual(
    await readFile(join(folder, "edited.kdenlive"), "utf8"),
    source,
  );
  await call("project_close", { sessionId });
  console.log(
    "Stdio acceptance passed: six tools, cuts, audio controls, music insertion/replacement, validation, exclusive save and original preserved.",
  );
} finally {
  await client.close();
  await rm(folder, { recursive: true, force: true });
}
