# OriginCoworks Next

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

**OriginCoworks Next** is an Apache-2.0 fork of [Craft Agents](https://github.com/lukilabs/craft-agents-oss) integrated end-to-end with the **JAcoworks Go gateway**. It keeps Craft's agent-native workbench (Electron desktop app, multi-tenant WebUI, headless server, and a Bun CLI) and replaces per-machine, static-token onboarding with a single gateway-driven control plane: one sign-in delivers your LLM configuration, permission policy, skills, memory, classic-session history, and release updates.

Like upstream, it runs the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and the Pi SDK side by side.

## What's different from Craft Agents

Everything below routes through the new `packages/origincoworks` adapter (the only network layer to the gateway) plus a small set of Go `/api/desktop/*` endpoints. Craft core edits are surgical, the internal `@craft-agent/*` npm scope is unchanged, and `CRAFT_*` environment variables remain valid as backward-compatible aliases.

- **Gateway-driven auth on every surface.** Desktop, WebUI, and the CLI all authenticate against the gateway (`POST /api/auth/login`) and store a session token; identity is verified via `GET /api/users/me`. There is no static `CRAFT_SERVER_TOKEN` onboarding gate anymore.
- **Gateway-backed LLM config.** `GET /api/desktop/config` (secret-redacted) auto-provisions a single managed `pi_compat` LLM connection (`OriginCoworks Gateway`) that hits the real xiaomao proxy (default model `gpt-5.5`, base `https://api.xiaomao.chat`). No manual provider/API-key onboarding.
- **Permission policy + audit.** Gateway role and workspace-trust checks run in pre-tool-use; high-risk commands are surfaced, and audit events `POST /api/desktop/audit`.
- **Skills sync + Memory source.** Checksum-based skills sync (system + user) keeps workspaces current, and a first-class `memory` source type is backed by gateway memory sync (read / search / write-with-permission).
- **Classic session import.** Read-only import of legacy sessions via `GET /api/desktop/classic-sessions`, continue-from-old via a transferred-session summary, and metadata write-back via `POST /api/desktop/session-metadata`.
- **Multi-tenant WebUI.** A front controller authenticates users via the gateway and spawns an isolated per-user headless backend (process-level tenant isolation, each with its own config dir). Logout tears the backend down.
- **Release + feedback.** Gateway `GET /api/desktop/release/latest` (DB-backed `releases` / `release_assets`) plus an auto-update feed pointed at the gateway, and `POST /api/desktop/feedback`.
- **Branding & data dir.** Product identity "OriginCoworks Next", bundle id `com.origincoworks.next`, deep-link scheme `origincoworks://`, default data dir `~/.origincoworks-next`, and a branded CLI (`ocn`).

> **Out of scope.** Release signing, macOS notarization, Windows NSIS signing, object-storage upload, and production deployment are **not** included. Release support covers only the `release/latest` endpoint + tables and the updater feed configuration.

## Architecture

```
JAcoworks-Next/
├── apps/
│   ├── cli/                   # Bun terminal client (ocn)
│   ├── electron/              # Desktop GUI (primary surface)
│   ├── viewer/                # Shared-session viewer
│   └── webui/                 # Browser UI (multi-tenant front controller)
├── packages/
│   ├── core/                  # Shared types
│   ├── shared/                # Business logic (agent, sources, sessions, config, credentials)
│   ├── origincoworks/         # Gateway adapter (the ONLY network layer to the gateway)
│   ├── server/                # Headless server + WebUI front controller
│   ├── server-core/           # RPC handlers
│   ├── ui/                    # Shared React UI
│   ├── pi-agent-server/       # Pi backend subprocess
│   └── session-mcp-server/    # Session tools MCP subprocess
└── gateway/                   # JAcoworks Go gateway (auth, config, skills, memory, audit, releases)
    ├── cmd/gateway/           # Entry point + route registration
    └── internal/              # auth, store, audit, config, ...
```

The `packages/origincoworks` adapter plugs into Craft's existing seams (login/onboarding, `LlmConnection`, `runPreToolUseChecks`, Sources, Skills, Sessions, WebUI auth). `gateway-client.ts` is the single HTTP client to the gateway.

## Prerequisites

- [Bun](https://bun.sh/) (monorepo runtime and package manager)
- [Go](https://go.dev/) (to build and run the gateway)
- A PostgreSQL database with the JAcoworks schema (the project's service manifest uses a Docker Postgres on port `5433`)
- For desktop packaging only: the platform toolchain used by `electron-builder`

## Setup

```bash
git clone https://github.com/fran0220/JAcoworks-Next.git
cd JAcoworks-Next
bun install
```

Then bring up the supporting services in order: **PostgreSQL → gateway → a surface** (desktop, WebUI, or CLI).

### 1. PostgreSQL

Start a PostgreSQL instance that holds the JAcoworks schema (users, sessions, skills, memory, audit, releases). Provide its connection string to the gateway via the `GATEWAY_DATABASE_URL` environment variable (see below) so secrets never need to live in the repo.

### 2. Gateway

The gateway reads a YAML config passed as a **positional argument** (not `-config`), and the database URL can be overridden by environment variable.

```bash
cd gateway

# Create a config from the template and fill in your values
cp gateway.yaml.example gateway.yaml

# Build
go build -o bin/gateway ./cmd/gateway

# Run (DB URL via env override; config path is positional)
GATEWAY_DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5433/jacoworks" \
  ./bin/gateway gateway.yaml
```

The gateway listens on port `8847` by default. Verify it:

```bash
curl -sf http://localhost:8847/health   # -> ok
```

Real LLM keys and other secrets are sourced from the database `system_settings` (and/or the env-overridable config), not from the repo. Keep your `gateway.yaml` out of version control.

## Run

By default every surface talks to the gateway at `http://127.0.0.1:8847`. Override it with `ORIGINCOWORKS_GATEWAY_URL`.

### Desktop (Electron)

```bash
bun run electron:build      # build main / preload / renderer / resources / assets
bun run electron:start      # build + launch the desktop app
```

On first launch the app shows a **gateway login screen** (not the legacy provider-onboarding wizard). After sign-in, the managed LLM connection is provisioned automatically and you can start chatting.

### WebUI (multi-tenant front controller)

The front controller authenticates each user via the gateway and spawns an isolated per-user headless backend on `9101+`.

```bash
bun run server:build:subprocess   # build the pi-agent + session-mcp subprocess bundles
bun run webui:build               # build the browser assets

CRAFT_RPC_PORT=9100 \
CRAFT_RPC_HOST=127.0.0.1 \
CRAFT_WEBUI_DIR=apps/webui/dist \
CRAFT_BUNDLED_ASSETS_ROOT=$PWD/apps/electron \
  bun run packages/server/src/front-controller.ts
```

Open `http://127.0.0.1:9100/login`. Each authenticated user gets a separate backend process with its own `CRAFT_CONFIG_DIR`; logging out tears that backend down.

### CLI (`ocn`)

```bash
# Show help
bun run apps/cli/src/index.ts --help

# Or alias it
alias ocn="bun run $(pwd)/apps/cli/src/index.ts"

# Sign in via the gateway (token persisted to ~/.origincoworks-next/cli.json)
ocn login <username> --gateway-password '<password>'
# or validate and store an existing 64-hex gateway session token
ocn login --token <64-hex>
```

## Test

```bash
# Monorepo unit/integration tests
bun test

# Gateway (Go)
cd gateway && go vet ./... && go test ./...
```

For TypeScript, run **scoped, per-package** typechecks, e.g.:

```bash
cd packages/shared && bun run tsc --noEmit
cd packages/origincoworks && bun run typecheck
cd apps/electron && bun run typecheck
```

> The repo's aggregate `bun run typecheck:all` is currently broken upstream (it references an untracked `tsconfig.base.json`, and a few packages that extend it have unrelated pre-existing errors). Use the scoped per-package typechecks above instead.

When you change anything under `apps/electron/src/renderer/**`, `packages/ui/**`, or `packages/shared/**`, also run `bun run electron:build` and confirm it produces `apps/electron/dist/renderer/index.html` — typecheck/test do not catch Vite/Rollup bundling regressions.

## Features

- **Multi-Session Inbox**: Desktop app with session management, status workflow, and flagging
- **Streaming agent experience**: Streaming responses, tool visualization, real-time updates
- **Gateway-managed LLM connection**: Model config is delivered by the gateway; per-workspace defaults still apply
- **Sources**: Connect to MCP servers, REST APIs (Google, Slack, Microsoft), local filesystems, and gateway-backed **memory**
- **Permission Modes**: Three-level system (Explore, Ask to Edit, Auto) with customizable rules, plus gateway role/workspace-trust policy
- **Background Tasks**: Run long-running operations with progress tracking
- **Dynamic Status System**: Customizable session workflow states (Todo, In Progress, Done, etc.)
- **Theme System**: Cascading themes at app and workspace levels
- **Multi-File Diff**: VS Code-style window for viewing all file changes in a turn
- **Skills**: Specialized agent instructions, kept in sync from the gateway (system + user) and per-workspace
- **File Attachments**: Drag-drop images, PDFs, Office documents with auto-conversion
- **Automations**: Event-driven automation — create agent sessions on label changes, schedules, tool use, and more
- **Classic session import**: Read-only import of legacy sessions, with continue-from-old support

### Sources

Connect external data sources to your workspace:

| Type | Examples |
|------|----------|
| **MCP Servers** | Linear, GitHub, Notion, custom stdio/remote servers |
| **REST APIs** | Google (Gmail, Calendar, Drive, YouTube, Search Console), Slack, Microsoft |
| **Local Files** | Filesystem, Obsidian vaults, Git repos |
| **Memory** | Gateway-backed memory (read / search / write-with-permission) |

To add a source, you can simply tell the agent ("add Linear as a source", or paste an MCP config JSON / OpenAPI spec) and it sets up credentials and configuration. Local stdio-based MCP servers run as subprocesses on your machine.

### Permission Modes

| Mode | Display | Behavior |
|------|---------|----------|
| `safe` | Explore | Read-only, blocks all write operations |
| `ask` | Ask to Edit | Prompts for approval (default) |
| `allow-all` | Auto | Auto-approves all commands |

Use **SHIFT+TAB** to cycle through modes in the chat interface. Gateway policy (role + workspace trust) is enforced on top of the selected mode, and high-risk commands are surfaced for review.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New chat |
| `Cmd+1/2/3` | Focus sidebar/list/chat |
| `Cmd+/` | Keyboard shortcuts dialog |
| `SHIFT+TAB` | Cycle permission modes |
| `Enter` | Send message |
| `Shift+Enter` | New line |

### Automations

Automations trigger actions when events happen — labels change, sessions start, tools run, or on a cron schedule.

**Just ask the agent:**
- "Set up a daily standup briefing every weekday at 9am"
- "Notify me when a session is labelled urgent"
- "Every Friday at 5pm, summarise this week's completed tasks"

Or configure manually in `~/.origincoworks-next/workspaces/{id}/automations.json`:

```json
{
  "version": 2,
  "automations": {
    "SchedulerTick": [
      {
        "cron": "0 9 * * 1-5",
        "timezone": "America/New_York",
        "labels": ["Scheduled"],
        "actions": [
          { "type": "prompt", "prompt": "Check @github for new issues assigned to me" }
        ]
      }
    ],
    "LabelAdd": [
      {
        "matcher": "^urgent$",
        "actions": [
          { "type": "prompt", "prompt": "An urgent label was added. Triage the session and summarise what needs attention." }
        ]
      }
    ]
  }
}
```

**Prompt actions** create a new agent session with a prompt. They support `@mentions` for sources and skills, and environment variables like `$CRAFT_LABEL` and `$CRAFT_SESSION_ID` are expanded automatically.

**Supported events:** `LabelAdd`, `LabelRemove`, `PermissionModeChange`, `FlagChange`, `SessionStatusChange`, `SchedulerTick`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, and more.

## CLI Reference

The CLI authenticates with the gateway and connects to a headless server over WebSocket (`ws://` or `wss://`). Use it for scripting, CI/CD pipelines, or server validation.

### Authentication & connection

```bash
# Gateway login (token persisted to ~/.origincoworks-next/cli.json)
ocn login <username> --gateway-password '<password>'
ocn login --token <64-hex>

# Gateway base URL (default: $ORIGINCOWORKS_GATEWAY_URL or http://127.0.0.1:8847)
ocn --gateway-url http://127.0.0.1:8847 login <username>
```

For direct server connections you can still pass `--url` / `--token` (or set `CRAFT_SERVER_URL` / `CRAFT_SERVER_TOKEN`). For TLS connections (`wss://`), use `--tls-ca <path>` for self-signed certificates.

### Commands

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the gateway and save the session token |
| `ping` | Verify connectivity (clientId + latency) |
| `health` | Check credential store health |
| `versions` | Show server runtime versions |
| `workspaces` | List workspaces |
| `sessions` | List sessions in workspace |
| `connections` | List LLM connections |
| `sources` | List configured sources |
| `session create` | Create a session (`--name`, `--mode`) |
| `session messages <id>` | Print session message history |
| `session delete <id>` | Delete a session |
| `send <id> <message>` | Send message and stream AI response |
| `cancel <id>` | Cancel in-progress processing |
| `invoke <channel> [args]` | Raw RPC call with JSON args |
| `listen <channel>` | Subscribe to push events (Ctrl+C to stop) |
| `run <prompt>` | Self-contained: spawn server, run prompt, stream response, exit |
| `--validate-server` | Integration test (auto-spawns server if no `--url`) |

### Examples

```bash
# Quick connectivity check
ocn ping

# List sessions (human-readable)
ocn sessions

# Send a message and stream the AI response
ocn send abc-123 "What files are in the current directory?"

# JSON output for scripting
ocn --json workspaces | jq '.[].name'

# Self-contained run (spawns its own server)
ocn run "Summarize the README"
ocn run --workspace-dir ./my-project --source github "List open PRs"
```

## Remote Server (Headless)

For most deployments, the **multi-tenant WebUI front controller** (above) is the recommended remote surface — it authenticates users via the gateway and isolates each user in their own backend process.

For single-tenant or thin-client setups, the lower-level headless server can also run on its own with a bearer token (the desktop app then connects as a thin client).

### Single-tenant server

```bash
# Generate a token and start the server
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run packages/server/src/index.ts
```

The server prints the connection details on startup:

```
CRAFT_SERVER_URL=ws://203.0.113.5:9100
CRAFT_SERVER_TOKEN=<generated-token>
```

Connect the desktop app in thin-client mode:

```bash
CRAFT_SERVER_URL=wss://203.0.113.5:9100 CRAFT_SERVER_TOKEN=<token> bun run electron:start
```

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRAFT_SERVER_TOKEN` | Yes (single-tenant) | — | Bearer token for client authentication |
| `CRAFT_RPC_HOST` | No | `127.0.0.1` | Bind address (`0.0.0.0` for remote access) |
| `CRAFT_RPC_PORT` | No | `9100` | Bind port |
| `CRAFT_WEBUI_DIR` | No | — | Path to built WebUI assets (front controller) |
| `CRAFT_RPC_TLS_CERT` | No | — | Path to PEM certificate file (enables `wss://`) |
| `CRAFT_RPC_TLS_KEY` | No | — | Path to PEM private key file (required with cert) |
| `CRAFT_RPC_TLS_CA` | No | — | Path to PEM CA chain file (optional, for client cert verification) |
| `ORIGINCOWORKS_GATEWAY_URL` | No | `http://127.0.0.1:8847` | Gateway base URL used by all surfaces |
| `CRAFT_CONFIG_DIR` | No | `~/.origincoworks-next` | Override the data directory |
| `CRAFT_DEBUG` | No | `false` | Enable debug logging |

### TLS (recommended for remote access)

When exposing the server over the network, TLS encrypts the WebSocket connection (`wss://` instead of `ws://`).

```bash
# Generate a self-signed certificate (development/testing)
./scripts/generate-dev-cert.sh   # creates certs/cert.pem and certs/key.pem

# Start with TLS
CRAFT_SERVER_TOKEN=<token> \
CRAFT_RPC_HOST=0.0.0.0 \
CRAFT_RPC_TLS_CERT=certs/cert.pem \
CRAFT_RPC_TLS_KEY=certs/key.pem \
  bun run packages/server/src/index.ts
```

For production, use certificates from a trusted CA (e.g., Let's Encrypt) or place the server behind a reverse proxy (nginx, Caddy) that terminates TLS.

### Docker

A multi-platform server image is provided via `Dockerfile.server`:

```bash
docker buildx build -f Dockerfile.server -t origincoworks-server .

docker run -d \
  -p 9100:9100 \
  -e CRAFT_SERVER_TOKEN=<token> \
  -e CRAFT_RPC_HOST=0.0.0.0 \
  -e CRAFT_CONFIG_DIR=/data \
  -v origincoworks-data:/data \
  origincoworks-server
```

To enable TLS in Docker, mount your certificates and set `CRAFT_RPC_TLS_CERT` / `CRAFT_RPC_TLS_KEY`.

## Supported LLM Providers

In OriginCoworks Next, the active LLM connection is provisioned by the gateway (`pi_compat` against the xiaomao proxy). The underlying Craft connection types are still available for advanced/standalone use:

### Direct connections

| Provider | Auth | Notes |
|----------|------|-------|
| **Anthropic** | API key or Claude Max/Pro OAuth | Direct Claude connection via the Claude Agent SDK |
| **Google AI Studio** | API key | Gemini models with native Google Search grounding |
| **ChatGPT Plus / Pro** | Codex OAuth | Uses OpenAI's Codex models via your ChatGPT subscription |
| **GitHub Copilot** | OAuth (device code) | Authenticate with your Copilot subscription |

### Third-party & self-hosted

Additional providers connect through the **Claude / Anthropic API Key** connection with a custom endpoint:

| Provider | Endpoint | Notes |
|----------|----------|-------|
| **OpenRouter** | `https://openrouter.ai/api` | Access many models via one key; use `provider/model-name` format |
| **Vercel AI Gateway** | `https://ai-gateway.vercel.sh` | Built-in observability and caching |
| **Ollama** | `http://localhost:11434` | Run open-source models locally; no API key required |
| **Custom** | Any URL | Any OpenAI-compatible or Anthropic-compatible endpoint |

### Agent backends

- **Claude** — powered by the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which natively supports custom base URLs and provider routing.
- **Pi** — powered by the Pi SDK, which handles Google AI Studio, ChatGPT Plus (Codex OAuth), GitHub Copilot OAuth, OpenAI API key, and OpenAI-compatible (`pi_compat`) connections such as the gateway-managed one.

## Configuration

Configuration is stored at `~/.origincoworks-next/` (override with `CRAFT_CONFIG_DIR`):

```
~/.origincoworks-next/
├── config.json              # Main config (workspaces, LLM connections)
├── credentials.enc          # Encrypted credentials (AES-256-GCM), incl. gateway session
├── preferences.json         # User preferences
├── theme.json               # App-level theme
├── cli.json                 # CLI gateway session/connection
└── workspaces/
    └── {id}/
        ├── config.json      # Workspace settings
        ├── theme.json       # Workspace theme override
        ├── automations.json # Event-driven automations
        ├── sessions/        # Session data (JSONL)
        ├── sources/         # Connected sources
        ├── skills/          # Skills (synced from gateway + custom)
        └── statuses/        # Status configuration
```

> Backward compatibility: `CRAFT_*` environment variables are still honored as aliases, and the internal `@craft-agent/*` npm scope is unchanged. The legacy `~/.craft-agent` path is no longer the default data directory.

### Deep linking

External apps can navigate using `origincoworks://` URLs:

```
origincoworks://allSessions                      # All sessions view
origincoworks://allSessions/session/session123   # Specific session
origincoworks://settings                         # Settings
origincoworks://sources/source/github            # Source info
origincoworks://action/new-chat                  # Create new session
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh/) |
| Gateway | Go |
| AI | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| AI (Pi) | Pi SDK agent server |
| Desktop | [Electron](https://www.electronjs.org/) + React |
| UI | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4 |
| Build | esbuild (main) + Vite (renderer) |
| Credentials | AES-256-GCM encrypted file storage |

## Troubleshooting

### Debug mode

To launch the packaged app with verbose logging, use `-- --debug` (note the double-dash separator):

**macOS:**
```bash
/Applications/OriginCoworks\ Next.app/Contents/MacOS/OriginCoworks\ Next -- --debug
```

The main log uses the product app name ("OriginCoworks Next"):
- **macOS:** `~/Library/Logs/OriginCoworks Next/main.log`
- **Windows:** `%APPDATA%\OriginCoworks Next\logs\main.log`
- **Linux:** `~/.config/OriginCoworks Next/logs/main.log`

Always-on lifecycle logs (auto-update, messaging gateway) are written under the data directory at `~/.origincoworks-next/logs/`.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses

This project uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is subject to [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms).

### Trademark

"Craft" and "Craft Agents" are trademarks of Craft Docs Ltd. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

### Local MCP Server Isolation

When spawning local MCP servers (stdio transport), sensitive environment variables are filtered out to prevent credential leakage to subprocesses. Blocked variables include:

- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (app auth)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
- `GITHUB_TOKEN`, `GH_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `STRIPE_SECRET_KEY`, `NPM_TOKEN`

To explicitly pass an env var to a specific MCP server, use the `env` field in the source config.

### Gateway secret redaction

The gateway's `GET /api/desktop/config` returns only LLM-relevant fields to clients; non-LLM secrets (search, asset, and other provider keys) are redacted and never reach desktop/WebUI/CLI surfaces.

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md).
