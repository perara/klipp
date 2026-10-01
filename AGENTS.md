# Working on Klipp

## Verify locally, 1:1 with CI

Every CI job in `.github/workflows/ci.yml` runs a command you can run locally. Run them before
you push. A red CI run means the local command and CI have drifted, so fix that rather than
working around it.

| CI job  | Local command      |
| ------- | ------------------ |
| `check` | `npm run check`    |
| `e2e`   | `npm run test:e2e` |

`npm run check` is format, typecheck, unit tests and build. `npm run test:e2e` builds the
package, then drives the example app in `examples/react-app` three ways: under the dev
server, as a production build under a base path, and on a touch phone.

## Rules

- **Generic.** Nothing here knows about any one app. App-specific behaviour is an option.
- **Redacted by default.** Reports never carry on-screen text, form values, or query values
  unless the reporter opts in, and form values never.
- **No stuck modes.** Every mode leaves with Esc and with a visible control, and works by
  touch. Only one mode is active at a time.
- **Strict-CSP safe.** No `innerHTML`, no inline `style` attributes, no inline scripts. Build
  DOM with `h()` and style through CSSOM.
- **Light on the host app.** The runtime that loads up front stays tiny. The UI loads on
  first use.
