# Contributing to Klipp

Thanks for helping. Bugs, ideas and pull requests are all welcome. For a bug or an idea, open an
issue with one of the forms. For a security problem, see [SECURITY.md](SECURITY.md) instead.

## Setting up

You need Node.js 22 or newer (see `.nvmrc`).

```bash
npm ci
npx playwright install chromium   # once, for the browser tests
```

## The everyday loop

```bash
npm run example                       # the example app with Klipp, at http://localhost:5173
KLIPP_REAL_AGENTS=1 npm run example   # the same, with your real `claude` and `codex`
```

Without `KLIPP_REAL_AGENTS`, the example uses a stand-in agent (`test/fake-agent.mjs`) that
speaks both CLIs' formats and calls Klipp's tools over MCP, so nothing needs a login.

## Before you push

CI runs exactly these commands, so run them first ([AGENTS.md](AGENTS.md) has the reasoning):

| Command               | What it checks                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run check`       | format, build, lint, typecheck, unit tests, and the package's exports                              |
| `npm run test:e2e`    | the example app under the dev server, a production build, on a touch phone, and as a paired device |
| `npm run test:compat` | the packed package against Vite 5, 6, 7 and 8                                                      |

A change in behaviour comes with a test that fails without it. A user-visible change gets a line
under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

## Pull requests

Keep a pull request to one change, and say in its description what changed, why, and how you
verified it. Commit messages say what changed and why, in the imperative or as a plain statement.

## Releasing

Maintainers only:

1. Move the **Unreleased** notes in `CHANGELOG.md` under the new version, and set `version` in
   `package.json`.
2. Commit, then tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.

The release workflow runs every check, attaches the packed tarball to a GitHub release with the
changelog notes, and publishes to npm with provenance once npm publishing is set up.

## Code of conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
