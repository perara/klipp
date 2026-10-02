# Klipp

A paperclip that lives in the corner of your web app while you build and test it. Click it,
tell it what looks wrong, and point at the thing you mean. Klipp reads the code that rendered
it, explains what's going on, and files a GitHub issue when you say so.

Its brain is a coding agent you already have: **Claude Code** or **Codex**, run in the
background by the dev server with your own login. No API keys.

```
you    the save button does nothing
klipp  Click the button you mean.            (you click it)
       📎 Reading src/features/editor/Toolbar.tsx
klipp  It's disabled: `canSave` is false until the form is dirty
       (Toolbar.tsx:42), and the form never marks itself dirty after a
       paste (useForm.ts:88). Want me to file an issue?
```

## Quick start

```bash
npm install -D https://github.com/perara/klipp/releases/download/v0.3.0/klipp-0.3.0.tgz
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import klipp from 'klipp/vite';

export default defineConfig({
  plugins: [react(), klipp()],
});
```

Then have `claude` (Claude Code) or `codex` (Codex CLI) installed and logged in on the same
machine. Klipp files issues with your GitHub CLI login (`gh auth login`), or `GITHUB_TOKEN`.

Klipp runs **under the dev server and is off in builds**. Turn it on for a test build with
`KLIPP=1 vite build` (the chat then works under `vite preview`), and off anywhere with
`KLIPP=0`. It's always off under Vitest.

## What Klipp sees

- **The element you point at:** its tag, state (disabled, hidden, covered by something else),
  the file and line that rendered it, the components it sits inside, its parent, and what lies
  beneath it.
- **The page:** its address (query values blanked), the viewport, and recent console errors
  and failed requests.
- **The code:** the agent works in your repository, read-only. Claude runs restricted to Read,
  Grep and Glob (no shell, no web, `.env` and key files denied), Codex in its read-only sandbox.
  Neither loads your own settings or other MCP servers.

It never sees the text on the page or what anyone typed into it. If the wording matters, it
asks. The agent reaches the page only through Klipp's own tools (point, inspect, propose an
issue), served to it over MCP on a loopback port with a per-run token. The page talks only to
its own origin, and the chat answers only requests from the same machine (`chat.allowRemote`
lets a phone on your LAN in).

## Stable element IDs

Every element in your JSX gets a `data-klipp` attribute at build time, holding a hash of where
it's written. Nobody writes IDs by hand. Each element's full ID is the same for every user and
every reload, and it leads back to a file and line:

```
3f9a2c1d.x7k2:2/1/0
└ sid ──┘ └inst┘ │ └ path into markup the build didn't stamp (third-party DOM)
                 └ which one, when identical instances repeat
```

The instance part comes from the component call sites and React keys above the element. A
shared `<Button>` used in two places gets two IDs, and a list row keeps its ID when the list
reorders. Open `https://your.app/page?klipp=3f9a2c1d.x7k2` and Klipp opens on that element.
Filed issues carry the ID and `klipp:3f9a2c1d`, so you can search for every report about the
same code. In the DevTools console, `klipp.id($0)` gives an element's ID and `klipp.find(id)`
finds it.

## Options

| Option                    | Default                           | What it does                                                    |
| ------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `enabled`                 | dev only                          | Force Klipp on or off.                                          |
| `chat`                    | `{}`                              | `{ agent, model, allowRemote }`, or `false` for no chat.        |
| `launcher`                | `bottom-right`                    | Corner for the paperclip, or `false` for hotkey only.           |
| `offset`                  | `{ x: 0, y: 0 }`                  | Pixels in from the corner, to clear things the app keeps there. |
| `hotkey`                  | `alt+shift+k`                     | Opens and closes the chat.                                      |
| `keepQuery`               | `[]`                              | Query parameters (such as `demo`) kept in addresses and links.  |
| `repo` / `commit`         | from `git`                        | Where permalinks and issues go.                                 |
| `include` / `exclude`     | `.jsx`/`.tsx`, not `node_modules` | Which files to stamp.                                           |
| `stampComponents`         | `true`                            | Mark component call sites so shared components tell uses apart. |
| `launcherUnderAutomation` | `false`                           | Show the paperclip under Playwright/WebDriver too.              |

`chat.agent` picks who answers first (`claude` by default, or `codex`); the chat has a switch
for the other one when both are installed, and remembers your choice. `chat.model` is passed to
the agent.

## Limits

- Content drawn on a canvas (maps, WebGL scenes) has no DOM, so pointing stops at the canvas.
- Markup inside other components' shadow roots isn't reached.
- Permalinks and issues use GitHub.

## License

MIT
