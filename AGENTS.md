# Working on Klipp

## Verify locally, 1:1 with CI

Every CI job in `.github/workflows/ci.yml` runs a command you can run locally. Run them before
you push. A red CI run means the local command and CI have drifted, so fix that rather than
working around it.

| CI job                    | Local command         |
| ------------------------- | --------------------- |
| `check` (node 22, 24, 26) | `npm run check`       |
| `e2e`                     | `npm run test:e2e`    |
| `compat` (vite 5-8)       | `npm run test:compat` |

`npm run check` is format, lint, typecheck, unit tests, build, and the package's exports
(publint and Are The Types Wrong). `npm run test:e2e` builds the package, then drives the example
app in `examples/react-app` four ways: under the dev server, as a production build under a base
path, on a touch phone, and as another device that has to pair. `npm run test:compat` installs the packed package next to each
supported Vite major and checks the build and the dev server.

## Rules

- **Generic.** Nothing here knows about any one app. App-specific behaviour is an option.
- **Nothing private leaves without a reason.** The agent never sees on-screen text, form values
  or query values; the GitHub token stays in the server; an issue is filed only after the user
  clicks to file it.
- **The agent can't change anything, or reach past the repository.** Claude runs
  `--restricted` with Read/Grep/Glob only; Codex in a sandbox that reads only the repository
  and writes nothing; neither loads the user's own settings or MCP servers, and each gets only
  the environment it needs.
- **Only the developer's browser.** The chat answers a browser on this machine at `localhost`,
  or a device paired under `chat.allowRemote`. Anything that changes who can reach the agent
  gets a test in `src/server/handler.test.ts`.
- **No stuck modes.** Every mode leaves with Esc and with a visible control, and works by
  touch. Only one mode is active at a time.
- **Strict-CSP safe.** No `innerHTML`, no inline `style` attributes, no inline scripts. Build
  DOM with `h()` and style through CSSOM.
- **Light on the host app.** The runtime that loads up front stays tiny. The UI loads on
  first use.
