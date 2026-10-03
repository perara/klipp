# Changelog

All notable changes to Klipp are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, a minor version may change
behaviour or options.

## [Unreleased]

### Added

- `klipp serve` and `klipp/server`: the chat as its own server, for a shared test environment
  behind a sign-in proxy. The proxy names the user in a header (`KLIPP_IDENTITY_HEADER`), and
  `KLIPP_ALLOW` can limit who may chat. Each conversation belongs to its user, messages are
  limited per user per hour, tickets say who reported them, and one JSON log line per turn and
  per ticket carries no message text. `GET /healthz` answers health checks, and `SIGTERM` stops
  every run. It won't listen beyond localhost without an identity header.

## [0.6.1] - 2026-10-02

### Fixed

- `klipp/canvas`'s types accept real MapLibre maps and three.js raycasters in projects that
  compile with `exactOptionalPropertyTypes`. The example app compiles that way now, so it stays
  so.

## [0.6.0] - 2026-10-02

### Added

- Pointing at what a canvas draws. `klipp/canvas` has `registerCanvas` and adapters for
  MapLibre GL (`maplibreTargets`: the topmost rendered feature, by layer and id, property values
  only when named in `reveal`) and three.js (`threeTargets`: the nearest visible object, by its
  name down the scene graph, instanced meshes by instance). The chat, the agent's context, the
  ticket and links all name the feature or object; an ID names it with `@key`. A canvas can
  carry several adapters, asked newest first, such as a three.js layer drawn over a MapLibre
  map, whose hand-set camera the three.js adapter aims through.
- react-three-fiber objects (`<mesh>`, `<group>` and the like) carry where they are written, as
  `userData.klipp`, so pointing at a 3D object leads to its JSX.
- Web components: Klipp points into open shadow roots, an ID steps into one with `s`, and the
  app's own JSX rendered into a shadow root keeps its ID and is found by links.
- The example app has a page with a MapLibre map, a react-three-fiber scene and web components.

### Fixed

- A message typed while Klipp was still finishing its answer was dropped; it is now shown at
  once and sent as soon as the answer is done.
- In files that use react-three-fiber, DOM elements (`<div>`, `<button>`, custom elements)
  weren't stamped; only three.js tags are left alone now.
- Backslash-escaped text in Klipp's replies shows without the backslashes.

## [0.5.0] - 2026-10-02

### Security

- The chat answers only a browser on this machine at `localhost`. A page that rebinds its own
  name to `127.0.0.1`, a tunnel and a reverse proxy were let in before, since they connect from
  loopback; now the address the request was sent to, and any forwarding headers, count too.
- `chat.allowRemote` now pairs each device once, with a code the dev server prints, instead of
  letting anyone on the network in.
- Codex is confined to the repository: a permission profile lets it read only the repository,
  the system files programs need and its own install, and the commands it runs get only a core
  environment. It could read the whole disk before.
- Agents no longer get the dev server's whole environment, only what they need to start and log
  in. `chat.passEnv` passes more by name.
- Claude is also denied `.envrc`, `.dev.vars`, Terraform variables and state, keystores,
  `.pypirc`, `.netrc`, `.pgpass`, `credentials*.json` and `.git/config`.
- The server files only a ticket the agent proposed in the conversation, once, while it waits on
  the user; the browser adds only the page details. Before, it filed any title and body.
- A GitHub token goes only to its own host: github.com tokens to github.com, Enterprise tokens
  to their host, nothing to GitLab or other remotes. Filed issue addresses must be `https`.
- Console errors are sent by name and message; objects logged with them are no longer
  serialized into the agent's context.
- The page context is escaped so it can't close its own tag, and the agent is told to treat it
  as data.
- Claude's MCP token moved from the command line to a file only you can read.
- A crafted `?klipp=` link can no longer put a link in Klipp's bubble.

### Added

- `chat.allowRemote` pairing, `chat.pairingCode` for a fixed code, `chat.passEnv` and
  `chat.maxRuns` (four agent runs at once by default).
- The ticket card shows the whole ticket and the page details that will be added, before
  anyone files it.
- HTTP/2 (`server.https`) support: requests carry `:authority` instead of `Host`.
- Files with decorators or import attributes (`with` and the older `assert`) are stamped; a
  file that can't be parsed is reported instead of silently skipped.
- `vite build --ssr` with `KLIPP=1` stamps the server bundle too, so hydrated markup keeps its
  IDs.

### Changed

- The Vite peer range is `^5.4.12 || ^6.0.9 || ^7 || ^8`: the first releases of 5 and 6 that
  check the `Host` header.
- Escape closes Klipp when focus is in Klipp; on the page, Escape is the page's again.
- On Windows the chat says to run the dev server in WSL, instead of that it can't find the
  agent.
- `vite preview` serves the chat only for a build made with Klipp.
- The manifest no longer includes the absolute repository root.
- `git status` for the manifest runs in the background, so a large repository doesn't stall the
  dev server.
- Self-hosted remotes on a custom port keep the port in permalinks.

### Fixed

- A page-tool call that threw left the agent waiting for 30 minutes; it now gets an error.
- A ticket card left over from a turn that ended no longer takes the user's next message.
- A message sent while the previous one was still collecting its element's details could run
  alongside it.
- Malformed lines from an agent, or malformed MCP requests, could crash the dev server.
- The MCP bridge and running agents are stopped when the dev server closes or restarts.
- More of Klipp's events stop at its own root: pointer and mouse moves, touch moves,
  composition, drag and drop.

## [0.4.0] - 2026-10-02

### Changed

- Klipp's job is now intake: it turns what testers notice into tickets the team can act on.
  The agent works out whether a report is a bug, a feature request, a suggestion or a question,
  asks for what that type of ticket needs, and looks up where it lives in the code.
- `propose_issue` became `propose_ticket`: a typed ticket, checked on the server against its
  type before the user sees it. A ticket with fields missing goes back to the agent.

### Added

- One body template per ticket type, a type badge and severity on the card, and GitHub labels
  per type (`bug`, `enhancement`, `suggestion`, `question`, each with `klipp`), configurable
  with `chat.labels`.

### Fixed

- A new ticket card scrolls fully into view.

## [0.3.1] - 2026-10-02

### Fixed

- File references from the agent show as `path:line` instead of links to local paths the page
  can't open.

## [0.3.0] - 2026-10-02

### Changed

- The chat runs the coding agent you already have, **Claude Code** or **Codex**, in the
  background with your own login, instead of calling the Claude API. Claude runs `--restricted`
  with Read, Grep and Glob only; Codex runs in its read-only sandbox. Neither loads the user's
  own settings or MCP servers.

### Added

- A small MCP server, on a loopback port with a per-run token, through which the agent reaches
  the page: `point_at_element`, `inspect_element`, and the issue draft.
- A Claude | Codex switch in the chat; each message resumes the agent's session.

### Removed

- The Anthropic SDK dependency and the need for an API key.

### Fixed

- The newest reply stays in view while it streams.

## [0.2.2] - 2026-10-02

### Fixed

- Key, input, clipboard, pointer and focus events from Klipp no longer reach the page's own
  listeners, so typing in the chat can't trigger the app's keyboard shortcuts.
- Source maps carry their sources.

## [0.2.1] - 2026-10-02

### Removed

- The `prepare` install script from the published package.

## [0.2.0] - 2026-10-02

### Changed

- The report panel became an animated paperclip with a chat: six moods, eyes that follow the
  pointer, and issue drafts filed only on the user's click.

## 0.1.0 - 2026-10-02

### Added

- Source-derived element IDs stamped at build time, element picking through a glass that keeps
  the page from reacting, `?klipp=` deep links, and redacted reports.

[Unreleased]: https://github.com/perara/klipp/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/perara/klipp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/perara/klipp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/perara/klipp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/perara/klipp/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/perara/klipp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/perara/klipp/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/perara/klipp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/perara/klipp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/perara/klipp/releases/tag/v0.2.0
