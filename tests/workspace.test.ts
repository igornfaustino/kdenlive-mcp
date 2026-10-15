import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/io/workspace.js";

const template = await readFile(
  new URL("./fixtures/native-26.08.2.kdenlive", import.meta.url),
  "utf8",
);
const temporaryFolders: string[] = [];
let fixture: string;
let root: string, input: string, workspace: Workspace;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kdenlive-mcp-test-"));
  temporaryFolders.push(root);
  input = join(root, "original.kdenlive");
  fixture = template.replace('root="."', `root="${root}"`);
  await writeFile(input, fixture);
  await writeFile(join(root, "tone.wav"), "fixture");
  workspace = await Workspace.create([root]);
});

afterEach(async () => {
  await Promise.all(
    temporaryFolders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("workspace safety", () => {
  it("saves an edited sibling, preserving the source and refusing overwrite", async () => {
    const session = await workspace.open(input);
    workspace.apply(session.sessionId, 0, [
      {
        type: "remove_ranges",
        trackId: "tractor1",
        ranges: [{ start: 25, end: 50 }],
      },
    ]);
    const output = join(root, "edited.kdenlive");
    await workspace.saveAs(session.sessionId, 1, output);
    expect(await readFile(input, "utf8")).toBe(fixture);
    expect(await readFile(output, "utf8")).not.toBe(fixture);
    await expect(
      workspace.saveAs(session.sessionId, 1, output),
    ).rejects.toThrow(/exists|EEXIST/);
    expect((await readdir(root)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
  it("rejects external edits, stale revisions and original paths", async () => {
    const { sessionId } = await workspace.open(input);
    await expect(
      workspace.saveAs(sessionId, 1, join(root, "new.kdenlive")),
    ).rejects.toThrow(/revision/i);
    await expect(workspace.saveAs(sessionId, 0, input)).rejects.toThrow(
      /original/i,
    );
    await writeFile(input, fixture + "\n");
    await expect(
      workspace.saveAs(sessionId, 0, join(root, "new.kdenlive")),
    ).rejects.toThrow(/changed/i);
    expect(await readdir(root)).not.toContain("new.kdenlive");
  });
  it("rejects traversal and symlink escapes", async () => {
    const outside = await mkdtemp(join(tmpdir(), "kdenlive-mcp-outside-"));
    temporaryFolders.push(outside);
    await writeFile(join(outside, "secret.kdenlive"), fixture);
    await symlink(
      join(outside, "secret.kdenlive"),
      join(root, "escape.kdenlive"),
    );
    await expect(workspace.open(join(root, "escape.kdenlive"))).rejects.toThrow(
      /root/i,
    );
    await expect(
      workspace.open(join(outside, "secret.kdenlive")),
    ).rejects.toThrow(/root/i);
    const { sessionId } = await workspace.open(input);
    await expect(
      workspace.saveAs(sessionId, 0, join(root, "..", "escape.kdenlive")),
    ).rejects.toThrow();
  });
  it("reports missing media and refuses to save unresolved projects", async () => {
    await writeFile(input, fixture.replaceAll(">tone.wav<", ">missing.wav<"));
    const { sessionId } = await workspace.open(input);
    const report = await workspace.validate(sessionId);
    expect(report.valid).toBe(false);
    expect(report.media.some((m) => m.status === "missing")).toBe(true);
    await expect(
      workspace.saveAs(sessionId, 0, join(root, "new.kdenlive")),
    ).rejects.toThrow(/media/i);
  });
  it("reports forbidden media without reading it", async () => {
    await writeFile(input, fixture.replaceAll(">tone.wav<", ">/etc/passwd<"));
    const { sessionId } = await workspace.open(input);
    expect(
      (await workspace.validate(sessionId)).media.some(
        (m) => m.status === "forbidden",
      ),
    ).toBe(true);
  });
  it("rejects ambiguous relative XML roots for relative media", async () => {
    await writeFile(input, template);
    const { sessionId } = await workspace.open(input);
    expect((await workspace.validate(sessionId)).valid).toBe(false);
    await expect(
      workspace.saveAs(sessionId, 0, join(root, "new.kdenlive")),
    ).rejects.toThrow(/media/i);
  });
  it("bounds sessions and releases them on close", async () => {
    const opened = await Promise.all(
      Array.from({ length: 32 }, () => workspace.open(input)),
    );
    await expect(workspace.open(input)).rejects.toThrow(/limit|session/i);
    const { sessionId } = opened[0]!;
    workspace.close(sessionId);
    expect(() => workspace.info(sessionId)).toThrow(/session/i);
    expect((await workspace.open(input)).sessionId).toBeTruthy();
  });
  it("rejects invalid UTF-8 and oversized inputs before XML editing", async () => {
    await writeFile(input, Buffer.from([0xff, 0xfe, 0x80]));
    await expect(workspace.open(input)).rejects.toThrow(/UTF-8/i);
    await writeFile(input, Buffer.alloc(16 * 1024 * 1024 + 1));
    await expect(workspace.open(input)).rejects.toThrow(/16 MiB/i);
  });
  it("only publishes one complete file when saves race", async () => {
    const a = await workspace.open(input),
      b = await workspace.open(input);
    const results = await Promise.allSettled([
      workspace.saveAs(a.sessionId, 0, join(root, "race.kdenlive")),
      workspace.saveAs(b.sessionId, 0, join(root, "race.kdenlive")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await readFile(join(root, "race.kdenlive"), "utf8")).toBe(fixture);
  });
});
