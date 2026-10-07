# Security

## Reporting a vulnerability

Please report security problems privately, through
[GitHub's private vulnerability reporting](https://github.com/perara/klipp/security/advisories/new)
(the **Report a vulnerability** button on the Security tab), not in a public issue. Expect a
first answer within a week. Once a fix is released, the advisory is published with credit,
unless you'd rather stay anonymous.

Only the latest release gets security fixes while Klipp is below 1.0.

## How Klipp is meant to be used

Klipp is a development tool. Its server part runs inside your Vite dev server (or
`vite preview`), on your machine, and it starts a coding agent with **your** login. Treat it like
the dev server itself: don't expose it to people you wouldn't let run your dev server.

What it does to keep that safe:

- **Nothing in production builds.** Klipp is off in `vite build` unless `KLIPP=1`, and off under
  Vitest. `vite preview` serves the chat only for a build made with Klipp.
- **Read-only agents, kept to the repository.**
  - Claude Code runs with `--restricted`, only the Read, Grep and Glob tools,
    `--strict-mcp-config`, and deny rules for `.env`, `.envrc`, `.dev.vars`, Terraform variables
    and state, keys, keystores, `.npmrc`, `.pypirc`, `.netrc`, `.pgpass`, `credentials*.json` and
    `.git/config`.
  - Codex runs `exec` with `--ignore-user-config` and a permission profile that reads only the
    repository, the system files programs need, and Codex's own install, and writes nothing.
    The commands it runs get only a core environment (`shell_environment_policy.inherit="core"`).
    Codex can't be given more than one deny rule, so it can read every file in the repository,
    `.env` files included.
  - Neither loads your own settings or other MCP servers, reaches the web, or edits files.
- **A trimmed environment.** An agent gets the variables it needs to start and log in (PATH,
  HOME, locale, proxies, certificates, and its own `ANTHROPIC_*`/`CLAUDE_*` or
  `OPENAI_*`/`CODEX_*` and cloud-provider settings), not the rest of the dev server's
  environment. `chat.passEnv` adds variables by name.
- **Arguments, not a shell.** Agents are started with `child_process.spawn` and an argument
  list, never through a shell. The message goes in on stdin. The MCP token is passed in a file
  only you can read, or in an environment variable, never on the command line.
- **Redacted page text.** The agent gets the page's structure and state, never its text or form
  values. Console errors go by name and message; objects logged with them are named, not
  serialized. Screenshots require approval of a local preview for each capture. DOM text, form
  values, media URLs and `data-klipp-private` subtrees are redacted. Canvas pixels may contain
  private data and must be reviewed before approval. Denial, closing or Escape sends no image.
  Approved screenshots may be attached only after a separate filing click; images committed to
  `klipp-attachments` inherit repository visibility and remain in history. Map features and 3D objects are described by their layer, geometry, type and
  name; property values only when the app names them in `reveal`. Query values in addresses are
  blanked. The page context is escaped so it can't
  close its own tag, and the agent is told it is data, not instructions.
- **Your browser only.** The chat, tool-result and issue endpoints need:
  - the `X-Klipp` header, which a cross-site form can't send;
  - an `Origin`, when there is one, that matches the address the request went to, and
    `Sec-Fetch-Site: same-origin` when the browser sends it;
  - a connection from loopback, addressed to `localhost`, `*.localhost`, `127.0.0.1` or
    `[::1]`, with no `Forwarded`, `X-Forwarded-*` or `Via` header. A page that rebinds its own
    name to `127.0.0.1` (DNS rebinding), a tunnel and a reverse proxy all fail this.
- **Pairing for other devices.** With `chat.allowRemote`, a request that isn't local needs a
  cookie (`HttpOnly`, `SameSite=Strict`) that a device gets once, by sending the code the dev
  server prints. Twenty wrong codes stop pairing until the dev server restarts.
- **A private tool channel.** The agent reaches the page through an MCP server bound to
  `127.0.0.1`, behind a random bearer token per dev-server start.
- **A click before anything is filed.** The card shows the whole ticket and the page details
  first. The server files only a ticket the agent proposed in that conversation, once, while it
  is waiting on the user. Tokens are scoped to their host: a github.com token goes only to
  github.com, and nothing goes to a remote that isn't GitHub. With a configured box, its GitHub login is used after a local token; the token never reaches
  apps or agents. With neither token nor box login for github.com: it hands that same ticket back once, as a link to GitHub's
  new-issue page, filled in, and the user submits it there, signed in as themselves.
- **Bounded.** At most four agent runs at once (`chat.maxRuns`), 50 conversations, 1 MB request
  bodies, and every run stops when its page goes away or the dev server closes.
- **No markup injection.** Agent output is rendered as DOM nodes, never through `innerHTML`, and
  only `http(s)` links are made clickable. Links into Klipp are checked before they are shown.

- **Behind a sign-in proxy** (`klipp serve` with `KLIPP_IDENTITY_HEADER`): the chat trusts the
  header the proxy sets, so the proxy must set it on every request and drop any value a browser
  sends, and Klipp's server must be reachable only through the proxy. Each conversation belongs
  to the user who started it, messages are limited per user per hour, tickets name their
  reporter, and the logs carry no message text. `klipp serve` won't listen beyond localhost
  without an identity header.

- **Smia on the web** (`klipp box` / `klipp smia` with `KLIPP_BOX_IDENTITY_HEADER`): only
  the reverse proxy may reach its port. The proxy must validate the session and overwrite both
  identity and roles headers, including on assets and streams. Smia refuses to start without
  `KLIPP_BOX_ROLES_HEADER` and `KLIPP_BOX_REQUIRED_ROLE`; every UI request needs a single
  validated e-mail and that exact role. Ambiguous/duplicate headers and malformed role lists
  are refused. The public host is explicit, its Origin must be HTTPS, and changes still require
  the page's CSRF header. An identity never authorizes `/v1`: the bearer token remains required.
  Without these settings the UI remains localhost-only with no sign-in; keep its port private.
  GitHub uses a device login with isolated HOME/GH_CONFIG_DIR in the private data folder;
  host credentials and keyrings are excluded. Issue receipts are consumed before network writes
  and retained across restarts; ambiguous failures are not retried. Apps holding a box token can
  file in any repository the GitHub login can access. Keep the token private.
  Agent, GitHub and token changes log the initiating identity without secrets. Run logs and agent
  sign-in sessions are shared among authorized owners: this is an administration page.

What it can't protect against:

- anyone who can already run code on your machine, as you;
- anyone you pair with `chat.allowRemote`, or let in behind a sign-in proxy, who can use the
  agent as you, and read through it whatever it can read;
- a page script in your own app, which runs in the same origin as Klipp;
- what the agent's model does with what it can read: with Codex, every file in the repository.
