So you're interested in helping out? That's great!

## Issuing PRs
Before issuing a PR, please run a few commands:

```bash
# Run all tests
make test
# Reformat all code
make fmt
```

This ensures that the basics work.

The headless-Chrome runtime tests (`runtime_e2e`, `runtime_multi_e2e`) only run with an explicit `SB_CHROME_PATH` (or `CHROMIUM_PATH`) and skip otherwise; they never auto-detect a browser. Point it at a `chrome-headless-shell`: `make test` defaults to Playwright's (installed by `make setup`). A system Chrome such as `/Applications/Google Chrome.app` is refused, because a headless instance of it that outlives a test takes over your own browser; set `SB_TEST_ALLOW_SYSTEM_CHROME=1` to override. Each runtime test fails if a browser outlives its server after SIGTERM.
