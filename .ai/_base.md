## Core Principle: Documentation is Infrastructure (if docs exist)

**If this project maintains documentation** (either `.ai/docs/`, project-level `docs/`, or both), then **harness documentation and agent context are part of your system infrastructure**. Whenever you change code, patterns, or agent behavior, update the corresponding docs in the same change—agents read these docs to understand how to behave consistently.

Use the `/update-docs` prompt to audit and fix docs after any change. The sync harness ensures all agents see the same current instructions.

**If this project has no docs**, skip this discipline. The sync harness works fine without it.

---

## How This File Works

The `.ai/` directory is the **Agents Config Sync** toolkit — the single source of truth for AI agent configuration in this repository, synced to every harness (Claude Code, Codex, Copilot, Antigravity CLI):

- `.ai/AGENTS.md` — project-specific agent context (edit this per project)
- `.ai/_base.md` — portable toolkit instructions (this content; reusable across projects)
- `.ai/skills/` — domain-specific knowledge for AI agents
- `.ai/prompts/` — slash commands invoked explicitly
- `.ai/docs/` — toolkit documentation (how the sync works, per-harness reference, verification steps)
- `.ai/mcp-servers.json` — MCP server definitions
- `.ai/scripts/sync.js` — the sync engine

/AGENTS.md is **auto-generated** by `.ai/scripts/sync.js` by concatenating, in order:
- `.ai/AGENTS.md` — project-specific context (overview, key directories, code style)
- a **generated skills, prompts & docs index** — built fresh on every sync from the files in `.ai/skills/`, `.ai/prompts/`, and the project's `docs/` folder (if present)
- `.ai/_base.md` — portable agent instructions, reusable across projects

**Never edit the generated files directly.** Edit the source files in `.ai/` and run `node .ai/scripts/sync.js` to regenerate. Memory should be kept in `.ai/AGENTS.md` rather than CLAUDE.md or AGENTS.md to ensure it is included in all agent contexts. Only project-specific details should go in `.ai/AGENTS.md` — everything else belongs in `.ai/_base.md` to be shared for agent consistency.

The sync script writes the combined content to:

| Generated file | Harness |
|---|---|
| `CLAUDE.md` | Claude Code |
| `AGENTS.md` | OpenAI Codex, Antigravity CLI, generic agents |
| `.github/copilot-instructions.md` | VS Code Copilot |
| `.agents/context/AGENTS.md` | Codex / Antigravity `.agents/` layout |

Skills and prompts are also synced:

| Source | Claude Code | Codex / Antigravity | Copilot |
|---|---|---|---|
| `.ai/skills/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` | `.github/skills/<name>/SKILL.md` |
| `.ai/prompts/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` | `.github/prompts/<name>.prompt.md` |

The sync also **generates a skills, prompts & docs index** and injects it between the two source files in every generated output: a link + description for each file in `.ai/skills/`, `.ai/prompts/`, and the project's `docs/` folder (recursive), plus an informational list of MCP servers configured in `.ai/mcp-servers.json` (an optional `description` key per server is used when present, falling back to the launch command or URL). Descriptions for skills/prompts/docs come from frontmatter `description` fields; project docs without frontmatter fall back to their first `# ` heading. The source files are never modified — the index exists only in the generated files, is rebuilt on every sync, and never needs manual maintenance.

Codex and Antigravity CLI share the same `.agents/` layout — skills, context, and MCP all live in one tree, so there's a single generated target per asset rather than one per harness.

MCP config is also synced:
- `.ai/mcp-servers.json` → `.mcp.json` (Claude Code + Copilot), `.codex/config.toml` (Codex), `.agents/mcp_config.json` (Antigravity CLI)

The Codex TOML is generated from the JSON source. If `.codex/config.toml` doesn't start with the `# ai-sync-generated` marker, it's treated as a user-owned file and left untouched.

The Antigravity profile carries a top-level `"_ai_sync_generated": true` flag — a hand-edited `.agents/mcp_config.json` (without that flag) is preserved untouched. Antigravity expects remote-server URLs under the `serverUrl` key; the sync auto-renames legacy `url`/`httpUrl` fields from `.ai/mcp-servers.json` during generation.

Both use the same YAML frontmatter format. The `description` field is required — it's what Claude Code reads to decide when to load the skill:
```yaml
---
name: My Skill
description: One-line description Claude uses to decide when to load this skill
---
```

Note: `.claude/commands/` is deprecated in favor of `.claude/skills/`. The sync script still writes prompts to both locations for backwards compatibility with older Claude Code setups, and cleans up stale generated entries in each.

Run `node .ai/scripts/sync.js` to sync manually, or `node .ai/scripts/sync.js --watch` to sync on file changes. Git pulls, checkouts, and VS Code folder opens also trigger the sync automatically.

### Toolkit Documentation

- [.ai/README.md](.ai/README.md) — full harness quickstart, structure, and sync details
- [.ai/docs/how-it-works.md](.ai/docs/how-it-works.md) — architecture and design rationale for the toolkit
- [.ai/docs/harness-support.md](.ai/docs/harness-support.md) — per-harness reference (Claude Code, Copilot, Codex, Antigravity CLI)
- [.ai/docs/test-instructions.md](.ai/docs/test-instructions.md) — how to verify commands, skills, MCP, and context files work in each harness

### Authoring Convention: Root-Relative Links

All cross-references inside `.ai/` source files (links to skills, docs, or other markdown) **must use root-relative paths**, e.g.:

```markdown
See [docs/systemArchitecture.md](docs/systemArchitecture.md) and
[.ai/skills/code-reviewer.md](.ai/skills/code-reviewer.md).
```

Symlinks resolve relative paths from the *link's location*, not the source file's. Since generated targets land at the repo root (`CLAUDE.md`, `AGENTS.md`) and inside `.github/`/`.claude/`, root-relative links work everywhere the files are consumed. Links may appear broken when navigating the `.ai/` source in an editor — that is expected.

### Global vs. Project Settings

Machine-specific preferences (API credentials, default models, personal rules) belong in global user config (`~/.claude/CLAUDE.md`, `~/.claude/settings.json`) — never committed to the repository. Shared project settings (permissions, hooks) go in `.claude/settings.json`, which is tracked. Only `.claude/settings.local.json` is gitignored.

---

## Documentation Maintenance

**Important distinction:** `.ai/docs/` documents the **agents-config-sync toolkit itself** (how to use it, per-harness reference, etc.). When you adopt this toolkit in your project, **do not edit `.ai/docs/`** unless you're contributing back to the agents-config-sync repo. Only toolkit maintainers should update `.ai/docs/`.

Instead, focus on your **project's own documentation**:

**Update these (your project):**

1. **`.ai/skills/`** — domain knowledge for *your project*: APIs, patterns, workflows, project conventions
2. **`.ai/AGENTS.md`** — project-specific context: key directories, code style, MCP tools, team info
3. **`docs/`** (if present) — **your project's living documentation**: architecture, guides, references (update as you work on the project)
4. **`README.md`** (root) — thin entry point; update if top-level orientation changes

**Do not edit these (toolkit infrastructure):**

- **`.ai/docs/`** — harness reference and toolkit instructions (maintained by agents-config-sync contributors only)
- **`.ai/_base.md`** — portable toolkit instructions (maintained by agents-config-sync contributors only)
- **`.ai/README.md`** — toolkit quickstart (maintained by agents-config-sync contributors only)

**Key principle:** Your `docs/` folder and `.ai/AGENTS.md` + `.ai/skills/` form **your project's knowledge base**. Whenever you change code, patterns, or project-specific behavior, update those docs in the same work. The toolkit docs stay static.

Remember: edit `.ai/` sources (project config), never the generated files, and run `node .ai/scripts/sync.js` after. The `/update-docs` command ([.ai/prompts/update-docs.md](.ai/prompts/update-docs.md)) audits your project docs on demand.

---

## Source Accuracy & Drafting Protocol

Never fabricate statistics, data points, or claims not explicitly present in source documents. If a fact cannot be verified from provided sources, flag it as `[NEEDS SOURCE]` rather than including it. Cross-reference all data attributions to ensure they match the correct source document and author.

### When drafting documents or conducting research from source materials:

1. **Read first, write second.** Read all provided source documents fully before drafting. Do not begin writing until all sources are loaded.
2. **Maintain a source map.** Track every factual claim, metric, name, or date back to its source. Present the draft clean (no inline tags), with a "Source Map" appendix listing each claim and its origin (document name, section/heading).
3. **Verify before delivering.** For substantive documents (strategy docs, external-facing reports, review comments, posts, presentations), spawn a verification agent that re-reads each source and checks every claim in the source map. Mark any unverifiable claim as `[UNVERIFIED]`.
4. **Separate verified from unverified.** Present the clean draft with unverified claims removed, plus a separate list of removed claims so the user can decide whether to add them back with proper sourcing.
5. **No invention.** Never generate statistics, percentages, quotes, or specific details not found in the sources — even if they seem plausible or "directionally correct."
