# Existing-project editing implementation plan

**Goal:** Deliver a working stdio MCP backed by an independently tested library
that modifies an existing Kdenlive project and saves an editable copy.

**Architecture:** Lossless source-span XML edits, conservative capability checks,
transactional in-memory changes and exclusive save-as persistence.

**Stack:** TypeScript, Node.js, pnpm, official MCP SDK, Zod, saxes, Vitest.

## Tasks

- [x] Research official format, MLT, installed runtime and comparison projects;
  record sources and risks in `docs/research.md`.
- [x] Save a native fixture in `tests/fixtures` and document provenance.
- [x] Write failing core tests for parsing, preservation, frame conversion,
  split/removal and rejection of unsafe edits in `tests/core.test.ts`.
- [x] Implement `src/core/xml.ts`, `time.ts`, `project.ts`, `editing.ts`.
  Run `pnpm test` and fix behavior until assertions pass.
- [x] Write failing I/O tests; implement `src/io/workspace.ts` for root
  containment, sessions, conflicts, validation and exclusive save-as.
- [x] Write failing MCP lifecycle tests; implement `src/mcp/server.ts` and
  `src/cli.ts` with revision-checked operations and structured errors.
- [x] Run type checking, build, tests and native MLT rendering; reopen an edited
  copy in Kdenlive. Record results in `docs/verification.md`.
- [x] Review implementation, fix findings, add README, example config and CI.

Local commits are required after verified increments; publication is not requested. The review
agent found attribute parsing and unmodeled timing bugs; both were reproduced in
failing tests and fixed. Its final review was interrupted by an account usage
limit. Local review, automated tests and native acceptance were completed.

## Audio increment — 2026-10-15

- [x] Clip-local volume and fades with native editor round-trip and RMS checks.
- [x] Existing-bin audio insertion into gaps and replacement preserving timing.
- [x] Native music round-trip, spectral measurement and sequential MCP acceptance.
- [x] Initialize Git and commit verified implementation chunks frequently.
- [x] Import local PCM16 mono/stereo WAV references into the bin through MCP;
  validate import/insertion/replacement via stdio and native audio evidence.
- [x] Reject corrupted FourCC identifiers and reconcile README/checklists with
  the implemented seven-tool server and 105-test suite.
- [ ] Expand validated video/effect operations and expose render jobs through MCP.
- [ ] Verify native editor behavior on Linux and Windows.
