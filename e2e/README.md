# Server E2E suite

Policy: [`E2E_POLICY.md`](../../E2E_POLICY.md). The default is one representative happy-path journey per capability. The tests below are the named exceptions: they cover failures or boundaries that cheaper tests cannot reach. Do not add new cases to them without a specific consequence to name.

## Layout and commands

| Directory | What | Run |
|---|---|---|
| `flows/` | Main user journeys, plus the device, MCP, encryption and external-editing exceptions below | `make test-e2e` (chromium; CI gate) |
| `safety/` | Data-loss and access-isolation exceptions | `make test-e2e` (same project) |
| `oidc/` | Real OIDC provider (Pocket ID), TLS and cross-host sessions. Separate Playwright config. | `make test-e2e-oidc` |
| `release/` | Embedded client bundle in the release binary | `make test-e2e-release` |
| `../browser-tests/` | Browser component tests with no server (layout, input, focus) | `make test-browser` |

`make test-e2e-all` runs `flows/` and `safety/` on chromium, firefox and webkit.

## Named exceptions

Each protects a consequence that is expensive or irreversible. Lower-level tests prove the server logic; these prove it through the browser, service worker or CLI.

| Test | Consequence | Why a lower level is not enough |
|---|---|---|
| `safety/sync-conflict.test.ts` | Conflicting offline edits lose one side | Needs a live service worker, local storage and the conflict UI together |
| `safety/unsynced-data.test.ts` | Failed saving, then logout, silently deletes unsynced edits | Needs the real logout path and browser-local databases |
| `safety/access-isolation.test.ts` | A read-only member writes, or enters another space or administration | Checks the editor UI and the `.fs` HTTP boundary with real sessions |
| `oidc/*` | Wrong admission, session sharing across hosts, logout that drops device credentials or unsynced encrypted drafts | Needs a real identity provider, TLS and distinct origins |
| `flows/encryption.test.ts`, `oidc/encryption.test.ts` | Browser-local data is stored readable, or an encrypted space cannot be reopened | Key handling spans IndexedDB, local storage and the sign-in form or popup |
| `flows/device-authorization.test.ts` | CLI sign-in grants a token to the wrong user or without browser approval | Runs the real `sb` binary against a real browser approval |
| `flows/mcp-authorization.test.ts` | An MCP client reaches spaces that were not ticked, or keeps access after revoke | Exercises the OAuth redirect flow and the `/.mcp` endpoint with a real token |
| `flows/external-editing.test.ts` | An edit made on disk is not shown in the open editor, so the next save overwrites it | Needs the file watcher, the open editor and its undo history together |

`release/embedded.test.ts` is a packaging check, not a safety exception.

## Extended browser coverage

`.github/workflows/browser-extended.yml` runs the OIDC project and the `flows/` and `safety/` tests on firefox and webkit. It has `workflow_dispatch` only: no schedule and no pull-request trigger, so it produces no failure signal unless someone starts it. No owner is recorded for its results. Before a release, run `make test-e2e-all` and `make test-e2e-oidc` by hand.
