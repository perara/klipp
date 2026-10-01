# Klipp

A debugging sidekick for web apps. Press <kbd>Alt+Shift+K</kbd> (or tap the paperclip),
point at whatever looks wrong, and Klipp tells you which line of code rendered it. It also
gives you a stable ID for that exact element and a bug report you can paste into a GitHub
issue.

```
Klipp: <button> in Button                          7est6jqn.oyy8
Code         src/components/Button.tsx:5:5        ↗ GitHub at the build's commit
Rendered by  <Button> in Toolbar · src/Toolbar.tsx:22:11
State        disabled · clicks at its centre land on <div> 8dhp5wq1.e35e
```

## Why the IDs are useful

Every element written in your JSX gets a `data-klipp` attribute at build time, holding a hash
of where it is written. Nobody writes IDs by hand. Because the ID comes from the source, it is
the same for every user and every reload, and it leads back to a file and line:

```
3f9a2c1d.x7k2:2/1/0
└ sid ──┘ └inst┘ │ └ path into markup the build didn't stamp (third-party DOM)
                 └ which one, when identical instances repeat
```

- **sid**: hash of `file:line:column`. The manifest maps it to the file, and the build's commit
  turns that into a GitHub permalink.
- **instance**: hash of the component call sites and React keys above the element. A shared
  `<Button>` used in two places gets two IDs, and a list row keeps its ID when the list
  reorders.

Paste an ID into a report and anyone can open `https://your.app/page?klipp=3f9a2c1d.x7k2`.
The page then opens with that element highlighted. Search your issues for `klipp:3f9a2c1d`
to find every report about the same code.

## Quick start

```bash
npm install -D github:perara/klipp
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import klipp from 'klipp/vite';

export default defineConfig({
  plugins: [react(), klipp()],
});
```

That's all. Klipp is **on under the dev server and off in builds**. Turn it on for a test or
demo build with `KLIPP=1 vite build`, and off anywhere with `KLIPP=0`. It is always off under
Vitest, so your snapshots don't change.

In the DevTools console:

```js
klipp.id($0); // → '7est6jqn.oyy8'
klipp.find('7est6jqn.oyy8'); // → the element
```

## What goes into a report

Reports are **redacted by default**. They include the element's tag, role, state (disabled,
hidden, covered, outside the viewport), its size and position, the code locations, the build,
and the browser. Query values and non-route URL fragments are blanked. The element's own text
is included only when the reporter ticks the box, and form values never are.

## Options

| Option                    | Default                           | What it does                                                          |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `enabled`                 | dev only                          | Force Klipp on or off.                                                |
| `include` / `exclude`     | `.jsx`/`.tsx`, not `node_modules` | Which files to stamp.                                                 |
| `stampComponents`         | `true`                            | Mark component call sites so shared components tell their uses apart. |
| `repo` / `commit`         | from `git`                        | Where permalinks point.                                               |
| `hotkey`                  | `alt+shift+k`                     |                                                                       |
| `launcher`                | `bottom-right`                    | Corner for the paperclip, or `false` for hotkey only.                 |
| `launcherUnderAutomation` | `false`                           | Show the paperclip under Playwright/WebDriver too.                    |

## How it works

- **Build** (`klipp/vite`): a pre-transform parses each JSX/TSX file with Babel and appends
  `data-klipp="sid"` to every element. It also appends `data-klipp-at="sid"` to every
  component from your own code. Third-party components, React built-ins and
  react-three-fiber objects are left alone. The attribute goes last, so a spread can't
  override it. It writes `klipp-manifest.json` (sid → file, line, owner) and injects a small
  runtime.
- **Browser** (`klipp/client`): the runtime walks React's fiber tree (the same in dev and
  production builds) to collect call sites and keys. Without React, it uses the stamped DOM
  ancestors instead. The UI lives in a Shadow DOM, is styled through CSSOM (so a strict CSP
  is fine) and loads on first use.
- **Picking** puts a transparent glass over the page, so nothing you point at reacts. Clicks,
  drags and map pans all stop at the glass, and disabled or covered elements can still be
  picked. Esc, the Cancel button and the hotkey all leave picking mode, and touch works too.

## Limits

- Content drawn on a canvas (maps, WebGL scenes) has no DOM, so picking stops at the canvas.
- Markup inside other components' shadow roots isn't reached.
- Permalinks use GitHub's URL layout.

## Roadmap

1. ✅ IDs, the picker, and a copyable report with permalinks
2. Filing GitHub issues from the panel through a server-side GitHub App
3. Chat with an assistant that sees the page context
4. Reading the code behind the element, plus adapters for canvas content

## License

MIT
