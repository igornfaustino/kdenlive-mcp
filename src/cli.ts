#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Workspace } from "./io/workspace.js";
import { createServer } from "./mcp/server.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: kdenlive-project-mcp --root /absolute/project/folder [--root /another/folder]\nRuns an MCP server over stdio. Only new sibling project files may be saved.",
  );
} else {
  try {
    const roots: string[] = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] !== "--root" || !args[i + 1])
        throw new Error("Expected --root /absolute/project/folder; use --help");
      roots.push(args[i + 1]!);
    }
    const server = createServer(await Workspace.create(roots));
    await server.connect(new StdioServerTransport());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
