# The AI box: Klipp's agents as a service

Status: design, approved in conversation on 2026-10-05; awaiting review of this document.

## Why

Today Klipp starts the Claude and Codex CLIs itself, in the same process or container as the chat.
Every place Klipp runs therefore carries both CLIs (about 1.6 GB) and its own copy of the
subscription logins. The owner wants:

- **One place for the logins**, set up from a web page.
- **Agent health at a glance**: installed, signed in, sandbox working.
- **API tokens** so Klipp, and later other apps, can call the agents.
- **Runs to watch**, live and afterwards.
- **A lighter Klipp**: the chat server without the CLIs.

These hold both locally and on square.uya.no.

## Decisions

- **Two services, one codebase.** `klipp serve` (the chat and page tools) and `klipp box` (the
  agents, an API and a setup web UI) ship in this package and run as separate containers. The
  box replaces the HolyClaude/CloudCLI trial in `~/projects/ai-box`.
- **Our own box, not CloudCLI or Paseo.** CloudCLI's token API (1.37.3, the latest) forces
  `bypassPermissions` and takes no system prompt, tool policy or MCP servers, so it can't run
  Klipp's read-only agent with page tools. We keep Klipp's existing agent code, which already
  does all of that for both CLIs, and put HTTP in front of it. Moving to the Claude Agent SDK
  or `codex app-server` is out of scope.
- **Owner-only use, no access-limiting code.** Anthropic does not allow routing requests through
  Pro/Max credentials on behalf of other users
  (code.claude.com/docs/en/legal-and-compliance), and OpenAI advises API keys for automated
  Codex use. The owner confirmed that only they use Klipp, through their own subscriptions.
  Tokens identify the calling app; they don't limit people.
- **The agent stays read-only.** Klipp's rules are unchanged. Claude runs `--restricted` with
  Read/Grep/Glob and the caller's tools only. Codex runs in a sandbox that reads only the
  repository and writes nothing. Neither loads user settings or MCP servers.

## Architecture

```
SQUARE (dev and prod), other apps
      │  /@klipp/*  (as today)
      ▼
klipp serve ─ chat + page tools; no CLIs, no logins
      │  box protocol v1, Bearer token
      ▼
klipp box ─ /v1 API · setup web UI · Claude + Codex CLIs
      └─ /data: logins, tokens, run logs      source: read-only mount
```

### Shared run code

The body of today's `spawnAgent`/`runTurn` becomes one function in `src/server/run.ts`:

```ts
runAgent(spec: RunSpec, hooks: {
  onEvent(event: AgentEvent): void;
  onTool(name: string, input: Record<string, unknown>): Promise<McpResult>;
  signal: AbortSignal;
}): Promise<void>
```

It owns the run directory, the MCP bridge registration, starting the CLI, parsing its output,
and the "stopped (exit N)" error. `RunSpec` gains `tools: McpTool[]`. Claude's
`--allowedTools` and the bridge's tool list come from the spec instead of the fixed
`PAGE_TOOL_NAMES`. Both Klipp's local mode and `klipp box` call it.

## Box protocol v1

Every request carries `Authorization: Bearer <token>`. A missing or unknown token gets 401.

**`GET /v1/agents`** returns `AgentsResponse`, the shape Klipp already uses: per agent,
`available` plus a `problem`. Not signed in counts as a problem ("Claude isn't signed in. Open
the AI box to sign in.").

**`POST /v1/runs`** takes:

```json
{
  "agent": "claude",
  "system": "…",
  "message": "…",
  "session": "optional id",
  "model": "optional",
  "tools": [{ "name": "point_at_element", "description": "…", "inputSchema": {} }]
}
```

Limits: `system` up to 64 KiB; `message` up to 256 KiB; `model` must match `^[\w.:\[\]-]{1,64}$`;
up to 16 tools, each `name` matching `^[a-z][a-z0-9_]{0,63}$`. Anything else gets 400.

- Errors before the stream starts:
  - 400: invalid request;
  - 409: the agent isn't ready, with its problem;
  - 429: more than `KLIPP_MAX_RUNS` runs at once (default 2).
- Otherwise 200, `application/x-ndjson`. Each line is one JSON object:
  - First, `{"type":"run","id":"<uuid>"}`.
  - Then `AgentEvent`s: `session`, `text`, `break`, `activity`, `error`, `done`.
  - `{"type":"tool_call","id":"<uuid>","name":"…","input":{…}}` when the agent calls one of
    the run's tools.
  - An empty line every 15 s, as keep-alive.
- The stream ends after `done` or `error`. If the caller closes it, the box sends SIGTERM to
  the CLI and answers any pending tool calls with "The turn ended."
- `session` continues a session only if the same token started it, as recorded in the run
  logs. Any other value starts a new session.

**`POST /v1/runs/:run/tools/:call`** takes `{ "content": "…", "isError": false }` and returns 204.

- 404 if the run or call is unknown or already answered.
- 403 if the token isn't the one that started the run.
- A call waits up to 30 minutes, the time a user may take to pick an element.

The box decides the repository root (`KLIPP_ROOT`), the CLI arguments, the sandbox and the
environment. Callers can't change any of them.

## `klipp box`

One Node process. Configuration:

| Variable           | Default           | Meaning                                                  |
| ------------------ | ----------------- | -------------------------------------------------------- |
| `KLIPP_ROOT`       | working directory | the repository the agents read                           |
| `KLIPP_BOX_HOST`   | `127.0.0.1`       | listen address                                           |
| `KLIPP_BOX_PORT`   | `8790`            |                                                          |
| `KLIPP_BOX_DATA`   | `~/.klipp-box`    | data directory                                           |
| `KLIPP_BOX_TOKENS` | none              | `name=token,…` tokens from the environment, e.g. Klipp's |
| `KLIPP_MAX_RUNS`   | `2`               | runs at once                                             |
| `KLIPP_MODEL`      | the CLI's default | a default model                                          |

The data directory is created with mode 0700, and every file in it with 0600:

- `claude/`: `CLAUDE_CONFIG_DIR` for every Claude process the box starts.
- `codex/`: `CODEX_HOME`.
- `tokens.json`: tokens made in the UI, as `{name, sha256, created, lastUsed}`. Only the hash
  is stored.
- `runs/<time>-<id>.jsonl`: one file per run. The first line holds the token name, agent,
  model, session and message; then every event and tool call with its answer. The newest 200
  files are kept.

### Setup web UI

The UI is served at `/`, with assets under `/ui/`. It is built like Klipp's own UI: plain
TypeScript, `h()` and CSSOM, no `innerHTML`, no inline styles or scripts, and a CSP of
`default-src 'self'`. Its JSON API is under `/ui/api/`.

- **Agents.** For each agent: the CLI version, signed in or not, and whether the sandbox works
  (Klipp's existing readiness checks).
  - **Sign in** starts the CLI's own login in the background, with no terminal:
    - Claude: `claude auth login`. It prints a link, then reads the pasted code from stdin. The
      UI shows the link and a code field, and writes the code to the CLI.
    - Codex: `codex login --device-auth`. It prints a link and a one-time code, then waits. The
      UI shows both and waits for the CLI to exit.
    - The UI follows the login over SSE (`GET /ui/api/logins/:id`). A login can be cancelled,
      and it ends by itself after 15 minutes.
  - **Sign out** runs `claude auth logout` or `codex logout`.
- **Tokens.** Create a named token; it is shown once, then only its hash is kept. Revoke a
  token. The list shows when each was last used. Environment tokens are listed as
  "from environment" and can't be revoked in the UI.
- **Runs.** The newest runs first: app, agent, start time, outcome. Opening a run replays its
  log, and continues live over SSE if the run is still going.

### Protection

None of this limits who may use the box; it keeps others away from the logins.

- `/v1` accepts any Host, but only a valid token.
- `/` and `/ui/*` answer only when the Host is `localhost`, `127.0.0.1` or `[::1]` (any
  port). This blocks DNS rebinding.
- A UI request that changes something must come from Klipp's runtime as `guard.ts`'s
  `fromKlipp()` defines it: the `X-Klipp: 1` header and a same-origin `Origin`.
- Locally, the box listens on 127.0.0.1. In a container it listens on all addresses, but the
  port is published only on the host's 127.0.0.1, or not at all.
- On square.uya.no, the UI isn't routed publicly. The owner reaches it with
  `ssh -L 8790:<box>:8790`.

## Klipp as a client

- `klipp serve` reads `KLIPP_BOX_URL` and `KLIPP_BOX_TOKEN`. The Vite plugin takes
  `chat.box: { url, token? }`, and reads the token from `KLIPP_BOX_TOKEN` when the
  option has none, so the token stays out of `vite.config`.
- With a box set:
  - `runTurn` posts the run with Klipp's system prompt, the page message, and the three page
    tools.
  - On a `tool_call` line it runs the existing browser round trip (`askBrowser`) and posts the
    result back.
  - Stopping the turn aborts the request.
  - `agents()` calls `GET /v1/agents`, cached for 10 seconds.
- Without a box, Klipp starts the CLIs locally as now, through `runAgent`.
- What the user sees when something goes wrong:
  - box unreachable: "The AI box at <url> isn't answering."
  - 401: "The AI box refused Klipp's token."
  - 429: "The AI box is busy; try again shortly."
  - stream lost before `done`: "Lost the AI box mid-answer."
  - an agent's own problem is shown as the box words it.

## Deployment

- **Image.** SQUARE's `deploy/klipp/Dockerfile` gets two targets:
  - `box`: Node, both CLIs, Klipp, the source at `/srv/square`, run as `klipp box`. Today's
    hardening stays: read-only root filesystem, all capabilities dropped, the userns-only
    seccomp profile, and the `klipp-codex` AppArmor profile where the host restricts user
    namespaces.
  - `serve`: Node and Klipp only, run as `klipp serve` in box mode.
- **Locally**, in `~/projects/ai-box`:
  - The compose file runs the `box` image with the SQUARE checkout mounted read-only at
    `/srv/square`, publishes `127.0.0.1:8790`, and keeps `/data` on a volume.
  - `KLIPP_BOX_TOKENS` holds a token for SQUARE's dev Klipp. SQUARE's dev setup reads
    `KLIPP_BOX_URL` and `KLIPP_BOX_TOKEN` from the environment.
  - HolyClaude is removed once the box has passed the real-login proof below.
- **square.uya.no** (PR #118, reworked):
  - `klipp`, the `serve` image, with a 128 MB memory limit.
  - `klipp-box`, the `box` image, with a 1 GB limit, a data volume, and the internal network
    only.
  - `square.env` holds the shared token.
  - The owner's one-time steps: open the SSH tunnel to the box UI, sign in Claude and Codex,
    and load the AppArmor profile.

## Testing

Unit tests (vitest, with fake CLIs as in today's tests):

- Protocol:
  - 401 without a token or with an unknown one;
  - 400 on each limit;
  - 409 when the agent isn't ready;
  - 429 over `KLIPP_MAX_RUNS`;
  - the event order;
  - the keep-alive line;
  - a tool call answered, a tool call left unanswered when the stream closes, and an answer
    from a different token;
  - closing the stream kills the CLI;
  - only a token's own session can be continued.
- Tokens: only the hash is stored, `lastUsed` updates, revoking works, environment tokens work.
- Run logs: the 0600 mode, and the 200-file limit.
- Sign-in flows, with fake CLIs: Claude prints a link and reads a code; Codex prints a link
  and code, then exits.
- Guard: a foreign Host gets 403 on `/` and `/ui/*`, and a UI change without `X-Klipp` or with
  a cross-site `Origin` gets 403.
- Klipp's box mode: each of the errors listed above, and the tool round trip.

End-to-end (Playwright):

- In the box UI:
  - agent status with fake CLIs;
  - a sign-in with a fake Claude, including pasting the code;
  - creating and revoking a token;
  - watching a run live.
- The example app through `klipp serve` in box mode to `klipp box` with a fake agent,
  including a `point_at_element` round trip.

In SQUARE:

- `deploy/test-klipp.sh` brings up both containers and checks:
  - Klipp answers 401 without a user and 200 with one;
  - the box answers 401 without a token;
  - the sandbox probe run through the box: the source is readable; the logins, the
    environment and the processes are hidden; writes are refused;
  - Codex is ready under the AppArmor profile.
- This runs in CI's `container-images` job and locally as `AGENTS.md` lists.

Real proof:

- The owner signs in both agents through the box UI.
- One Claude turn and one Codex turn then run from SQUARE's dev server through Klipp and the
  box, and appear under Runs.

## Out of scope

- Limits on who may use Klipp or the box, beyond guarding the logins (owner decision).
- Moving to the Claude Agent SDK or `codex app-server`.
- A password for the box UI. It is reached only from this machine or through an SSH tunnel.
- Several people sharing one box.
