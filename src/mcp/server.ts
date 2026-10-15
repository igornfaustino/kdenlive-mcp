import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ProjectError } from "../core/errors.js";
import type { Workspace } from "../io/workspace.js";

const frame = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sessionId = z.string().uuid();
const operation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("insert_audio_clip"),
      trackId: z.string().min(1),
      sourceId: z.string().min(1),
      at: frame,
      sourceIn: frame,
      sourceOut: frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("replace_audio_clip"),
      clipId: z.string().min(1),
      sourceId: z.string().min(1),
      sourceIn: frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("set_clip_audio"),
      clipId: z.string().min(1),
      gainDb: z.number().min(-60).max(20),
      fadeInFrames: frame,
      fadeOutFrames: frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("remove_ranges"),
      trackId: z.string().min(1),
      ranges: z
        .array(z.object({ start: frame, end: frame }).strict())
        .min(1)
        .max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("split_clip"),
      clipId: z.string().min(1),
      offset: frame,
    })
    .strict(),
]);

async function result(
  action: () => unknown | Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const data = (await action()) as Record<string, unknown>;
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    const code =
      error instanceof ProjectError
        ? error.code
        : ((error as NodeJS.ErrnoException).code ?? "INTERNAL_ERROR");
    const data = {
      code,
      message: error instanceof Error ? error.message : "Unknown failure",
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
}

export function createServer(workspace: Workspace): McpServer {
  const server = new McpServer(
    { name: "kdenlive-project-mcp", version: "0.1.0" },
    {
      instructions:
        "Edit saved Kdenlive projects incrementally. Inspect first. All times are integer project frames; ranges are [start,end). Clip handles are revision-scoped. Save only to a new sibling file. The live editor and unsaved edits are not controlled. Unsupported layouts fail explicitly.",
    },
  );
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const edit = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  };
  server.registerTool(
    "project_open",
    {
      description:
        "Open a saved .kdenlive inside allowed roots and return session, revision, tracks, clips and media.",
      inputSchema: { path: z.string().min(1) },
      annotations: edit,
    },
    ({ path }) => result(() => workspace.open(path)),
  );
  server.registerTool(
    "project_info",
    {
      description:
        "Inspect current project state. Use fresh clip handles after each edit.",
      inputSchema: { sessionId },
      annotations: read,
    },
    ({ sessionId }) => result(() => workspace.info(sessionId)),
  );
  server.registerTool(
    "project_validate",
    {
      description:
        "Validate references and recognized media files without executing the project. Does not certify editor compatibility.",
      inputSchema: { sessionId },
      annotations: read,
    },
    ({ sessionId }) => result(() => workspace.validate(sessionId)),
  );
  server.registerTool(
    "timeline_apply",
    {
      description:
        "Atomically apply a batch to the expected revision. Remove half-open timeline ranges with ripple confined to one track, split a clip at a relative frame offset, or set clip-local gain in dB and fade durations in frames. Audio settings replace only unchanged stacks created by this server; zero disables. Insert audio from existing bin sources into empty space or replace an effect-free audio clip while retaining duration. At most one operation per track per batch. Complex effects, groups and mixes are rejected.",
      inputSchema: {
        sessionId,
        expectedRevision: frame,
        operations: z.array(operation).min(1).max(100),
      },
      annotations: edit,
    },
    ({ sessionId, expectedRevision, operations }) =>
      result(() => workspace.apply(sessionId, expectedRevision, operations)),
  );
  server.registerTool(
    "project_save_as",
    {
      description:
        "Save the expected revision to a NEW sibling .kdenlive file. Refuse overwrites, changed source or unresolved media.",
      inputSchema: {
        sessionId,
        expectedRevision: frame,
        path: z.string().min(1),
      },
      annotations: edit,
    },
    ({ sessionId, expectedRevision, path }) =>
      result(() => workspace.saveAs(sessionId, expectedRevision, path)),
  );
  server.registerTool(
    "project_close",
    {
      description: "Release a session and its unsaved in-memory edits.",
      inputSchema: { sessionId },
      annotations: { ...edit, destructiveHint: true },
    },
    ({ sessionId }) => result(() => workspace.close(sessionId)),
  );
  return server;
}
