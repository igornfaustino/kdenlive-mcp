# Repository skills

These project-local skills are copied from the owner's preferred collection at
`/Users/igornfaustino/Developer/skills/skills` (2026-10-14).
They include the original supporting templates and references. Copies are
self-contained; changes to the source collection do not automatically update them.

## Installed selection

- [create-prd](create-prd/SKILL.md) — source: `skills/delivery/create-prd`
- [create-tasks](create-tasks/SKILL.md) — source: `skills/delivery/create-tasks`
- [create-techspec](create-techspec/SKILL.md) — source: `skills/delivery/create-techspec`
- [execute-bugfix](execute-bugfix/SKILL.md) — source: `skills/delivery/execute-bugfix`
- [execute-review](execute-review/SKILL.md) — source: `skills/delivery/execute-review`
- [execute-task](execute-task/SKILL.md) — source: `skills/delivery/execute-task`
- [clean-code](clean-code/SKILL.md) — source: `skills/dev/clean-code`
- [clean-code-guard](clean-code-guard/SKILL.md) — source: `skills/dev/clean-code-guard`
- [clean-ddd-hexagonal](clean-ddd-hexagonal/SKILL.md) — source: `skills/dev/clean-ddd-hexagonal`
- [test-driven-development](test-driven-development/SKILL.md) — source: `skills/dev/test-driven-development`

## Applicability

Use each skill only for its stated task. Installing a skill does not initiate its
workflow. The attached Kdenlive project brief was used to select relevant skills;
the installation itself is separate from the implementation and technical research
documented in the repository root and `docs/`.

The collection's frontend-design, modern-web-guidance, web-design-guidelines,
and execute-qa skills are omitted because they target web interfaces and browser
QA, outside the described headless MCP scope. There is no dedicated MCP or
Kdenlive skill in the preferred collection.

## Integration notes

The source files are preserved unchanged. Some delivery templates assume Bun,
Playwright MCP, Claude-specific tool names, or `.claude/skills`. When applying
those templates, follow the user's project instructions and actual available
tools. The brief proposes Node.js, pnpm, and Vitest; do not introduce Bun or a web
UI merely to satisfy template examples. Repository-local skills live here in
`.agents/skills`.

Delivery skills mix `tasks/` and `docs/tasks/` paths. Resolve the actual document
location before running a workflow, and keep subsequent artifacts together.
Use the user's Context7 CLI instructions for current library documentation.
