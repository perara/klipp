<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/klipp-logo-dark.svg">
    <img alt="Klipp" src=".github/assets/klipp-logo.svg" height="120">
  </picture>
</p>

<h3 align="center">The paperclip that turns “this looks wrong” into a ticket your team can act on.</h3>

<p align="center">
  <a href="https://github.com/perara/klipp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/perara/klipp/ci.yml?branch=main&style=flat-square&label=ci"></a>
  <a href="https://github.com/perara/klipp/releases"><img alt="Release" src="https://img.shields.io/github/v/release/perara/klipp?style=flat-square&color=d4a72c"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/perara/klipp?style=flat-square&color=57606a"></a>
  <img alt="Vite plugin" src="https://img.shields.io/badge/vite-plugin-646cff?style=flat-square&logo=vite&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/react-ready-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="Works with Claude Code" src="https://img.shields.io/badge/Claude_Code-works_with-d97757?style=flat-square&logo=anthropic&logoColor=white">
  <img alt="Works with Codex" src="https://img.shields.io/badge/Codex-works_with-10a37f?style=flat-square&logo=openai&logoColor=white">
</p>

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a> ·
  <a href="#how-it-works"><b>How it works</b></a> ·
  <a href="#tickets"><b>Tickets</b></a> ·
  <a href="#privacy-and-safety"><b>Privacy</b></a> ·
  <a href="#options"><b>Options</b></a>
</p>

<p align="center">
  <img alt="A tester tells Klipp the Save button doesn't work and points at it. Klipp reads the code, asks one question, and files a bug ticket with the right label." src=".github/assets/klipp-demo.gif" width="860">
</p>
<p align="center"><sub>Recorded from the example app with <code>npm run demo:record</code>. The agent is scripted for a steady pace; its lines come from a real Codex session.</sub></p>

---

Klipp lives in the corner of your web app while you build and test it. A tester clicks the
paperclip, says what's wrong or what they'd like, and points at the thing they mean. Klipp works
out whether it's a **bug**, a **feature request**, a **suggestion** or a **question**, asks only
for what that kind of ticket still needs, finds where it lives in the code, and files it on
GitHub when they say so.

Its brain is a coding agent you already have, **Claude Code** or **Codex**, run in the background
by your dev server with your own login. There are no API keys and nothing to host.

<table>
  <tr>
    <td width="33%" valign="top">
      <h4>🎯 Point, don't describe</h4>
      Testers click the element instead of describing it. Every element carries a stable ID
      derived from the source, so the ticket names the exact file, line and component, even in
      a list or a shared component.
    </td>
    <td width="33%" valign="top">
      <h4>🧭 Triage built in</h4>
      Each ticket type has what it needs: steps and severity for a bug, the need behind a feature
      request. An incomplete ticket goes back to the agent, which asks for what's missing, one
      question at a time.
    </td>
    <td width="33%" valign="top">
      <h4>🔒 Yours, and read-only</h4>
      The agent runs on your machine with your login and can't change a file. It never sees the
      text on the page, and nothing is filed until someone clicks <b>File ticket</b>.
    </td>
  </tr>
</table>

## Quick start

**Requirements:** Node.js 22+, Vite 5.4.12+ to 8, and for the chat, `claude` or `codex` on macOS or
Linux (on Windows, run the dev server in WSL). Element IDs tell instances apart through React;
other JSX frameworks get the code location, without the call-site detail.

```bash
npm install -D https://github.com/perara/klipp/releases/download/v0.4.0/klipp-0.4.0.tgz
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import klipp from 'klipp/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), klipp()],
});
```

Then:

1. Have [Claude Code](https://code.claude.com) (`claude`) or [Codex](https://github.com/openai/codex) (`codex`) installed and logged in on the same machine.
2. Log in to the GitHub CLI (`gh auth login`), or set `GITHUB_TOKEN`, so Klipp can file tickets.
3. Run your dev server, open the app at `localhost`, and click the paperclip, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>.

To let testers in from other devices, such as a phone on your network, set `chat.allowRemote`.
The dev server then prints a pairing link; each device opens it once.

Klipp runs **under the dev server and is off in builds**. Turn it on for a test build with
`KLIPP=1 vite build` (the chat then works under `vite preview`), and off anywhere with `KLIPP=0`.
It's always off under Vitest.

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/klipp-flow-dark.svg">
    <img alt="How it works: a tester tells and points, Klipp asks what's missing, the ticket is checked for its type, and it is filed on GitHub" src=".github/assets/klipp-flow.svg" width="860">
  </picture>
</p>

The dev server runs the agent once per message and resumes its session, so the conversation
carries on. The agent reaches the page only through Klipp's three tools, served to it over MCP on
a loopback port, behind a token that lives as long as the dev server:

| Tool               | What it does                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `point_at_element` | Asks the tester to click something; returns its ID, code location, components and state. |
| `inspect_element`  | Looks up an element by its ID, such as something underneath the one the tester clicked.  |
| `propose_ticket`   | Shows the ticket for the tester to file, once it has everything its type needs.          |

## Tickets

| Type               | When                                          | Klipp collects                                        | Labels                 |
| ------------------ | --------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| 🐞 Bug             | Something doesn't work as intended            | what happens, what should, steps, how often, severity | `bug`, `klipp`         |
| ✨ Feature request | Something the app can't do yet that is needed | the need, what would help, who it helps, today's way  | `enhancement`, `klipp` |
| 💡 Suggestion      | Something works but could be better           | what's there now, the change, why it's better         | `suggestion`, `klipp`  |
| ❓ Question        | How something is meant to work                | the question, and the answer from the code            | `question`, `klipp`    |

Every ticket also gets the element's Klipp ID, a permalink to its code at the build's commit, the
components it sits in, its state (disabled, hidden, covered), the page, the build and the
browser, so nobody has to ask "where?" or "which version?". The card shows all of it before
anyone files. Change the labels with `chat.labels`.

Klipp files on github.com, or on GitHub Enterprise when `gh` is logged in to that host
(`gh auth login --hostname`). A token is only ever sent to the host it belongs to.

### Stable element IDs

At build time every element in your JSX gets a `data-klipp` attribute, holding a hash of where it
is written. Nobody writes IDs by hand. The full ID is the same for every user and every reload,
and it leads back to a file and line:

```
3f9a2c1d.x7k2:2/1/0
└ sid ──┘ └inst┘ │ └ path into markup the build didn't stamp (third-party DOM)
                 └ which one, when identical instances repeat
```

The instance part comes from the component call sites and React keys above the element. So a
shared `<Button>` used in two places gets two IDs, and a list row keeps its ID when the list
reorders. Open `https://your.app/page?klipp=3f9a2c1d.x7k2` and Klipp opens on that element. In
the DevTools console, `klipp.id($0)` gives an element's ID and `klipp.find(id)` finds it.

## Privacy and safety

- **No page text.** The agent sees structure and state, never the text on the page or form values. Console errors are sent by name and message; objects logged with them are named, not opened. Query values in addresses are blanked, except the ones you list in `keepQuery`.
- **Read-only agents, kept to your repository.** Claude runs `--restricted` with only Read, Grep and Glob: no shell, no web, and `.env`, key and credential files are denied. Codex runs in a sandbox that reads only the repository and the system files programs need, and writes nothing; its commands get only a core environment. Neither loads your own settings or other MCP servers, and neither gets the dev server's environment beyond what it needs to start and log in.
- **Your browser only.** The chat answers a browser on this machine at `localhost`, from the page itself. Other names, tunnels and proxies are turned away, even from loopback, so a site that rebinds its name to `127.0.0.1` gets nothing. With `chat.allowRemote`, other devices pair once with the code the dev server prints.
- **Nothing filed without a click.** The card shows the whole ticket first, and the server files only the ticket the agent proposed, once.
- **Out of your page's way.** Klipp's key, pointer and focus events stop at its own root, so your page's handlers don't see them (only listeners on `window` or `document` in the capture phase, which see everything, still do).
- **Strict-CSP friendly.** Klipp uses no `innerHTML`, no inline styles and no inline scripts.

[SECURITY.md](SECURITY.md) has the details, and what Klipp does not protect against.

## Options

| Option                    | Default                           | What it does                                                           |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `enabled`                 | dev only                          | Force Klipp on or off.                                                 |
| `chat.agent`              | `claude`                          | Who answers first; the chat can switch to the other.                   |
| `chat.model`              | the agent's default               | Passed to the agent.                                                   |
| `chat.labels`             | see [Tickets](#tickets)           | GitHub labels per ticket type.                                         |
| `chat.allowRemote`        | `false`                           | Let other devices and addresses in, each paired once.                  |
| `chat.pairingCode`        | random per start                  | A fixed pairing code (10+ characters), for a shared test environment.  |
| `chat.passEnv`            | `[]`                              | More environment variables to pass to the agent, by name.              |
| `chat.maxRuns`            | `4`                               | Agent runs at once, across all conversations.                          |
| `chat`                    | `{}`                              | `false` turns the chat off and keeps pointing and links.               |
| `launcher`                | `bottom-right`                    | Corner for the paperclip, or `false` for the hotkey only.              |
| `offset`                  | `{ x: 0, y: 0 }`                  | Pixels in from the corner, to clear things the app keeps there.        |
| `hotkey`                  | `alt+shift+k`                     | Opens and closes the chat.                                             |
| `keepQuery`               | `[]`                              | Query parameters (such as `demo`) kept in addresses and links.         |
| `repo` / `commit`         | from `git`                        | Where permalinks and tickets go.                                       |
| `include` / `exclude`     | `.jsx`/`.tsx`, not `node_modules` | Which files to stamp.                                                  |
| `stampComponents`         | `true`                            | Mark component call sites, so shared components tell their uses apart. |
| `launcherUnderAutomation` | `false`                           | Show the paperclip under Playwright and WebDriver too.                 |

## Meet Klipp

<p align="center">
  <img alt="Klipp's moods: idle, hello, thinking, talking, pointing and sad" src=".github/assets/klipp-moods.svg" width="760">
</p>

His eyes follow your pointer. He hops when he says hello, sways while he thinks, bounces as he
talks, leans in while you point, and droops when something goes wrong.

## Limits

- Content drawn on a canvas (maps, WebGL scenes) has no DOM, so pointing stops at the canvas.
- Markup inside other components' shadow roots isn't reached.
- Permalinks and tickets use GitHub.
- Codex can read every file in the repository, `.env` files included; Claude is denied those. Keep secrets out of the working tree, or use Claude.

## Development

```bash
npm run check        # format, build, lint, typecheck, unit tests and package exports (CI `check`)
npm run test:e2e     # the example app under the dev server, a production build, touch, and a paired device
npm run test:compat  # the packed package against Vite 5, 6, 7 and 8
npm run demo:record  # re-record the demo GIF above (needs ffmpeg)
```

The tests use a stand-in agent that speaks both CLIs' formats and MCP, so they need no login. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get started, and [SECURITY.md](SECURITY.md) for how Klipp
keeps the agent contained and how to report a problem.

## License

[MIT](LICENSE) © 2026 Per-Arne Andersen

<p align="center"><sub>Made with 📎 for the people who find the bugs.</sub></p>
