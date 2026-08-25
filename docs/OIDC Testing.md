---
tags: development
references:
- server/src/auth/oidc.rs
- server/src/multi/users.rs
- e2e/oidc/README.md
- e2e/oidc/compose-dex.yaml
---

Testing procedures for the OIDC single sign-on feature. Configuration is covered in [[Install/Configuration#Single sign-on (OIDC)]]; the user-facing behavior in [[Authentication#OpenID Connect (OIDC)]] and [[HTTP API#OIDC routes (`oidc` feature)]]. The automated harness this page references lives in `e2e/oidc/`.

# Layers

| Layer | Needs a running server? | Needs a real IdP? | Needs a browser? |
|---|---|---|---|
| Backend (unit + HTTP API) | yes (no IdP) | no | no |
| Frontend (admin UI) | yes | no | headless ok |
| Integration (full SSO flow) | yes | yes | yes |

Keep the provider-free layers green first (`make check`, `make test`, `make test-e2e`); only then move to integration.

# Providers

**Dex** — fully local, deterministic; recommended for automation:

```shell
podman compose -f e2e/oidc/compose-dex.yaml up -d --build
```

Test user `admin@example.com` / `password` (fixed in `e2e/oidc/dex-config.yaml`). SilverBullet is built by the same compose file from `e2e/oidc/Dockerfile.silverbullet` with the `oidc` feature enabled.

**Authentik** — realistic claims, external instance. Create an application + confidential OAuth2 provider (scopes `openid profile email`, subject mode = user UUID, redirect URI `http://localhost:3000/.oidc/callback`), then export `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_TEST_USER`, `AUTHENTIK_TEST_PASSWORD`.

Gotchas that have cost time before:

* The issuer must match discovery exactly — scheme **and trailing slash**
* Auth codes expire fast (~60 s): warm the browser/harness before starting a login
* A missing or empty secret disables OIDC silently — verify enablement with `curl -I http://localhost:3000/.oidc/login` (302 = enabled, 404 = disabled)

# Backend checklist

Run against a bare multi-space server, any provider absent:

- [ ] Default build (no features): `/.oidc/login` → 404 — the feature is truly optional
- [ ] Build without the `oidc` feature but with `SB_OIDC_*` env set: still 404 (runtime env can't conjure the feature)
- [ ] Feature enabled, no `SB_OIDC_ISSUER`: boot clean, `/.oidc/login` → 404
- [ ] Issuer set but client id/secret/redirect missing: boot fails naming the missing variable
- [ ] `GET /.oidc/login` issues the signed `sb_oidc_state` cookie (HttpOnly, Lax) and 302s to the provider with `response_type=code`, `code_challenge_method=S256`, `scope=openid+profile` (single `openid`)
- [ ] Callback direct hits — missing code / missing state / no cookie / tampered HMAC — each → `302 …login?oidc_error=1` with a distinct server-log reason and nothing sensitive in the response body
- [ ] `POST /.spaces/api/admin/users/<u>/display-name`: input trims; `null` clears; whitespace-only clears; unknown user → structured error JSON
- [ ] `POST …/oidc-unlink` nulls issuer+subject and keeps the display name; unknown user → structured error
- [ ] `POST …/oidc-link` round-trips an arbitrary (issuer, subject)
- [ ] `users.json` afterwards contains typed fields only, hashes intact

The router-level portion of this list is automated in `server/src/multi/admin_api.rs`; the boot/config rows remain manual.

# Frontend checklist

No IdP needed. The automated pass is `e2e/users-oidc-admin.test.ts` (`make test-e2e`); verify manually in a normal browser at `http://localhost:3000/.spaces/`:

- [ ] Login page offers **Sign in with SSO** only when OIDC is enabled
- [ ] Users list renders display names beneath opaque account names; plain accounts get no redundant line
- [ ] Advanced block styling matches SpaceForm's details pattern and is keyboard-operable
- [ ] Display-name editor placeholder shows the account name; saving whitespace behaves as clear
- [ ] Source hint text matches reality after each action (override vs synced vs fallback)
- [ ] Unlink confirm dialog warns about password-only sign-in; Cancel makes no changes
- [ ] Read-only issuer/subject inputs select-all on focus
- [ ] Long values (64-char subjects) don't break layout

# Integration checklist

Drive the full SSO flow headlessly first (`node e2e/oidc/flow.mjs dex happy /` etc. — see `e2e/oidc/README.md`), then by hand:

Automated (exit-code checked):

- [ ] Happy path: state cookie issued → provider round-trip → exact redirect target → session cookie issued, state cookie cleared
- [ ] Replay of the same auth code → `oidc_error`
- [ ] Malicious `?return=` values (7-case table in `flow.mjs sanitize`) sanitize to `/`
- [ ] Malformed callbacks (missing params, no cookie, tampered HMAC) all bounce to `oidc_error`
- [ ] ID-token claims decode: `iss`/`aud` match config, `nonce` echoes, `sub` present (`claims.mjs`)
- [ ] State-cookie TTL: after >600 s a captured state cookie is rejected (`expiry.mjs --wait 615`; ~11 min)

Manual (browser, human eyes):

- [ ] Click-through: login button → provider → landed session, correct space visible
- [ ] Auto-provision: fresh provider user with `SB_OIDC_AUTO_PROVISION=true` lands as a new non-admin account
- [ ] Linked-user login: pre-linked identity lands in the existing account
- [ ] Return mount: start from `/.oidc/login?return=/notes/`, land exactly there
- [ ] Logout ends the session; SSO button reappears; re-login works immediately
- [ ] Two browsers/two identities simultaneously: independent sessions
- [ ] Redirect-URI/issuer/secret mismatches fail fast with documented errors, not hangs
- [ ] Second login for the same identity refreshes session and syncs display name (unless admin-overridden)
