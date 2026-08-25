# OIDC integration harness

Provider-in-the-loop scripts for the `oidc` feature. These complement the
provider-free suites (`make test`, `make test-e2e`) by exercising the real
redirect flows against a live OpenID Connect provider.

## Providers

| Provider | How it runs | Credentials |
|---|---|---|
| `dex` | Local compose stack: `podman compose -f e2e/oidc/compose-dex.yaml up -d --build` (or `make test-oidc-integration`) | `admin@example.com` / `password` (fixed in `e2e/oidc/dex-config.yaml`) |
| `authentik` | Any reachable Authentik instance | `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_TEST_USER`, `AUTHENTIK_TEST_PASSWORD` — from the environment or `test-env/.env` (gitignored) |

SilverBullet must be running with the `oidc` feature and matching env
(`SB_OIDC_ISSUER`, `SB_OIDC_CLIENT_ID`, `SB_OIDC_CLIENT_SECRET`,
`SB_OIDC_REDIRECT_BASE`). Override the target instance with `SB_BASE_URL`
(default `http://localhost:3000`).

## Scripts

```shell
# Full SB-mediated flow: state cookie, provider round-trip, redirect target,
# session issue, replay + malformed-callback rejection. Exit code reflects pass/fail.
node e2e/oidc/flow.mjs dex happy /my-space/
node e2e/oidc/flow.mjs dex sanitize     # malicious ?return= values sanitize to /
node e2e/oidc/flow.mjs dex errors       # missing code/state, no cookie, tampered HMAC

# Decode ID-token claims from a direct token exchange (SB not involved).
node e2e/oidc/claims.mjs dex

# State-cookie TTL enforcement (waits 615 s past login; override with --wait).
node e2e/oidc/expiry.mjs dex --wait 615
```

All scripts print `ok`/`FAIL` lines and exit non-zero on any failure.

## One-command run

```shell
make test-oidc-integration
```

Builds the server image, starts Dex + SilverBullet via compose, runs the
`dex` flow/claims scripts against them, and tears the stack down.
