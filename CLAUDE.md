# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Setup

This is a private fork of [OpenClaw](https://github.com/openclaw/openclaw) with local customizations (Docker-in-Docker support, SearXNG search provider, container hardening).

- **origin**: `git@github.com:zeattacker/myoc.git` (private fork)
- **upstream**: `https://github.com/openclaw/openclaw.git` (original repo)

To pull upstream updates: `git fetch upstream && git merge upstream/main`

## Build & Development Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies (uses pnpm 10.x, lockfile enforced) |
| `pnpm build` | Full production build (tsdown → `dist/`) |
| `pnpm dev` | Run in dev mode |
| `pnpm check` | Run format check + typecheck + lint (all-in-one quality gate) |
| `pnpm lint` | Oxlint with `--type-aware` |
| `pnpm lint:fix` | Auto-fix lint + format |
| `pnpm format` | Format with oxfmt |
| `pnpm test` | Run all tests (custom parallel runner) |
| `pnpm test:fast` | Unit tests only (vitest, excludes gateway/extensions) |
| `pnpm test:e2e` | End-to-end tests |
| `pnpm test:coverage` | Unit tests with V8 coverage |
| `pnpm test:watch` | Vitest in watch mode |

**Run a single test file:**
```bash
pnpm exec vitest run src/path/to/file.test.ts
```

**Docker image build & deploy:**
```bash
docker build -t openclaw:local .
docker compose up -d openclaw-gateway
```

## Architecture Overview

OpenClaw is a multi-channel AI agent gateway. It connects LLM providers to messaging channels through a unified gateway server.

```
Channels (Telegram, Discord, Slack, ...)
        ↓
   Gateway Server (Express + WebSocket, port 18789)
        ↓
   Agent Runtime (system prompt + tools)
        ↓
   LLM Providers (OpenAI, Anthropic, Gemini, ...)
```

### Key source directories (`src/`)

- **`gateway/`** — HTTP/WS server, auth, sessions, OpenAI-compatible API, control UI
- **`agents/`** — Core agent logic: system prompt construction, tool dispatch, sandbox, skills, subagents
- **`agents/tools/`** — Tool implementations (web-search, web-fetch, browser, exec, cron, memory, message, media)
- **`channels/`** — Channel abstraction layer: dock, registry, plugin loading, allowlists, routing
- **`config/`** — Zod-validated configuration system (`openclaw.json`), types, schema, defaults
- **`commands/`** — CLI command implementations (gateway, agent, config, status, doctor, etc.)
- **`cli/`** — CLI wiring (Commander program, argument parsing, profiles)
- **`providers/`** — LLM provider abstractions
- **`infra/`** — Environment, dotenv, ports, heartbeat, updates, discovery

### Channel plugins

Built-in channels live in `src/` (telegram, discord, slack, signal, imessage, whatsapp). Extension channels live in `extensions/` as workspace packages (matrix, msteams, irc, feishu, twitch, voice-call, etc.).

### Skills

Markdown-driven workflows in `skills/` — auto-discovered from `~/.openclaw/skills/<name>/SKILL.md` at runtime. Bundled skills (50+) include 1password, github, discord, coding-agent, etc.

### Web UI

Lit-based web UI in `ui/` (separate workspace package). Build with `pnpm ui:build`, dev with `pnpm ui:dev`.

## Coding Conventions

- **TypeScript ESM** with strict typing. Use `.js` extensions in imports. Use `import type` for type-only imports.
- **No `any`** — `typescript/no-explicit-any` is set to error in oxlint.
- **Files under ~500 LOC** (guideline, ~700 soft limit). Split/refactor when it improves clarity.
- **Tests colocated** as `*.test.ts` next to source. E2E tests as `*.e2e.test.ts`. Live tests as `*.live.test.ts`.
- **Tool schemas**: avoid `Type.Union`; no `anyOf`/`oneOf`/`allOf`. Use `stringEnum`/`optionalStringEnum` for string lists.
- **Dependency injection** via `createDefaultDeps`.
- **Run `pnpm check` before commits.**

## Commit Conventions

- Use `scripts/committer "<msg>" <file...>` to commit (auto-scopes staging, clears unrelated staged files).
- Concise, action-oriented messages (e.g., `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.

## Docker Setup (This Fork)

The `docker-compose.yml` runs two services from the `openclaw:local` image:

- **openclaw-gateway** — Persistent gateway server (ports 18789/18790), mounts `~/.openclaw` config and Docker socket
- **openclaw-cli** — Interactive CLI (stdin/tty attached)

Environment configured via `.env` file. Key vars: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_CONFIG_DIR`, `OPENCLAW_IMAGE`.

## Things to Avoid

- Never update the Carbon dependency.
- Never edit `node_modules`.
- Patched dependencies (`pnpm.patchedDependencies`) must use exact versions (no `^`/`~`).
- Patching dependencies requires explicit approval.
- Do not set test workers above 16.
