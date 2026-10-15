import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server.js";
import { Workspace } from "../src/io/workspace.js";

it("exercises an MCP editing session, schemas, errors, saving and closing", async () => {
  const root = await mkdtemp(join(tmpdir(), "kdenlive-mcp-protocol-"));
  const fixture = await readFile(
    new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
    "utf8",
  );
  await writeFile(
    join(root, "native.kdenlive"),
    fixture.replace('root="."', `root="${root}"`),
  );
  await writeFile(join(root, "tone.wav"), "fixture");
  const server = createServer(await Workspace.create([root]));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      "project_open",
      "project_info",
      "project_validate",
      "project_import_audio",
      "timeline_apply",
      "project_save_as",
      "project_close",
    ]);
    const opened = await client.callTool({
      name: "project_open",
      arguments: { path: join(root, "native.kdenlive") },
    });
    expect(opened.isError).not.toBe(true);
    const sessionId = (opened.structuredContent as Record<string, unknown>)
      .sessionId;
    const applied = await client.callTool({
      name: "timeline_apply",
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: "remove_ranges",
            trackId: "tractor1",
            ranges: [{ start: 25, end: 50 }],
          },
        ],
      },
    });
    expect(
      (applied.structuredContent as Record<string, unknown>).duration,
    ).toBe(225);
    const stale = await client.callTool({
      name: "timeline_apply",
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [{ type: "split_clip", clipId: "playlist2:0", offset: 5 }],
      },
    });
    expect(stale.isError).toBe(true);
    expect((stale.structuredContent as Record<string, unknown>).code).toBe(
      "REVISION_CONFLICT",
    );
    const audio = await client.callTool({
      name: "timeline_apply",
      arguments: {
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
      },
    });
    expect(audio.isError).not.toBe(true);
    expect((audio.structuredContent as Record<string, unknown>).revision).toBe(
      2,
    );
    const invalidAudio = await client.callTool({
      name: "timeline_apply",
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: "set_clip_audio",
            clipId: "playlist2:1",
            gainDb: -9,
            fadeInFrames: 1,
            fadeOutFrames: 10,
          },
        ],
      },
    });
    expect(invalidAudio.isError).toBe(true);
    expect(
      (invalidAudio.structuredContent as Record<string, unknown>).code,
    ).toBe("INVALID_AUDIO");
    const validated = await client.callTool({
      name: "project_validate",
      arguments: { sessionId },
    });
    expect((validated.structuredContent as Record<string, unknown>).valid).toBe(
      true,
    );
    const saved = await client.callTool({
      name: "project_save_as",
      arguments: {
        sessionId,
        expectedRevision: 2,
        path: join(root, "result.kdenlive"),
      },
    });
    expect(saved.isError).not.toBe(true);
    expect(
      (await readFile(join(root, "result.kdenlive"), "utf8")).length,
    ).toBeGreaterThan(1000);
    await client.callTool({ name: "project_close", arguments: { sessionId } });
    const closed = await client.callTool({
      name: "project_info",
      arguments: { sessionId },
    });
    expect(closed.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
