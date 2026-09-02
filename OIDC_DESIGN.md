# OIDC Integration — SilverBullet self-contained authentication

This is a pure OIDC branch rebuilt on upstream `main`; it contains no
proxy-auth implementation.

## Goal

SilverBullet handles its own authentication against Authentik via OIDC, so
Traefik no longer needs ForwardAuth on every request (pure forwarding). SB:
initiates login (302 -> Authentik authorize), exchanges the code, verifies the
ID token via JWKS, mints its own session cookie (existing `Authenticator`), and
authorizes per space via `members` (spaces.json). Anonymous browsing of public
spaces stays open; private spaces require a session.

## Context

- The implementation is rebuilt directly on the latest upstream multi-space
  infrastructure. No trusted-header authentication code is included.
- Existing infrastructure reused by the implementation:
  - `Authenticator` (self-signed JWT + cookie helpers) in
    `server/src/auth/authenticator.rs`; cookie helpers in `auth/cookie.rs`
    (`auth_cookie_name`, `cookie_value`, `request_host`, ...).
  - `RequestAuthorizer` trait (`authorize(method, path, headers) ->
    Option<AuthOutcome>`), `AuthContext`, `Actor` extension —
    `server/src/auth/authorizer.rs`.
  - `JwtAuthorizer` (`auth/jwt_authorizer.rs`) with `with_filter(authenticator,
    audience, issuer, filter: Fn(&Claims) -> bool)`.
  - `require_authorization` middleware wiring in `server/src/router.rs`.
  - `/.profile` handler returns the Actor; front-end reads it.
  - Front-end 401 handling in `client/spaces/http_space_primitives.ts`:
    follows a `location` response header (redirects to it), reloads when a
    401/403 has no header.

## New env vars

- `SB_OIDC_ISSUER` — issuer base URL, e.g. `https://auth.xiteng.site/application/o/wiki/`
  (discovery document at `<issuer>/.well-known/openid-configuration`).
- `SB_OIDC_CLIENT_ID`, `SB_OIDC_CLIENT_SECRET`.
- `SB_OIDC_REDIRECT_URI` — e.g. `https://wiki.xiteng.site/.oidc/callback`.
- OIDC mode activates when `SB_OIDC_ISSUER` and `SB_OIDC_CLIENT_ID` are set.
- `SB_PROXY_ADMINS` — comma-separated OIDC administrator usernames. The name
  is retained for deployment compatibility with the fork; a future upstream
  discussion can rename it to `SB_OIDC_ADMINS`.

## Implementation outline

1. **New `server/src/auth/oidc.rs`**:
   - `OidcConfig::from_env() -> Option<OidcConfig>` (None unless configured).
   - Discovery fetch (reqwest; cache the document) for authorize_endpoint,
     token_endpoint, jwks_uri, issuer.
   - `authorize_url(return_to) -> String`: response_type=code, client_id,
     redirect_uri, scope=openid+profile, state (HMAC-signed return path with a
     server secret — stateless), PKCE code_challenge (S256) with code_verifier
     kept in a short-lived signed state too (or HMAC both into state).
   - `handle_callback(code, state) -> Result<username, OidcError>`: verify
     state signature, PKCE verifier, POST token exchange, verify ID token
     signature via JWKS (rsa/simple ES), check issuer/aud/exp, extract
     `preferred_username` (fall back to `sub`).
   - Mint an SB session JWT using the existing `Authenticator`
     (`issue`/session API) and set the auth cookie — mirror what
     `LoginManager` does for username+password, minus the verifier.
2. **Routes** (in `server/src/router.rs`, alongside `/.auth`):
   - `GET /.oidc/login?return_to=...` -> 302 to Authentik authorize.
   - `GET /.oidc/callback?code=...&state=...` -> exchange, mint cookie,
     302 back to the original page (from state).
   - `GET /.oidc/logout` -> clear cookie, redirect to
     `SB_OIDC_ISSUER`-based logout or `/`.
3. **Space authorization** (`server/src/multi/instance.rs`, Accounts branch):
   - OIDC mode: authorizer = `JwtAuthorizer::with_filter(authenticator, "", "",
     filter)` where filter allows `members.contains(username)` (admins via
     `SB_PROXY_ADMINS`). Identity comes from the SB session JWT (already
     signed by our Authenticator). login stays None (no SB login page).
   - Public spaces keep (None, None) -> anonymous open.
   - Ensure the 401 path from `require_authorization` carries a
     `location: /.oidc/login` header (or the front-end gets a
     redirect header) so the client bounces to Authentik. Check
     `server/src/router.rs` / `server/src/handlers/auth.rs` for where 401s
     are built; the front-end (`http_space_primitives.ts`) already follows a
     `location` header on 401/403.
4. **spaces_ui** (`server/src/multi/space_index.rs`): OIDC mode verifies the
   host-wide JWT cookie via `state.authenticator`, accepts only versionless
   claims, and reads the administrator flag from `SB_PROXY_ADMINS`.
5. `server/src/multi/admin_api.rs`: OIDC mode uses the same JWT-based admin
   gate, also restricted to versionless sessions and `SB_PROXY_ADMINS`.

## Tests

- Unit tests for state signing/verification, authorize URL construction,
  ID-token claim extraction (no network).
- Full workspace build and test suites are green.

## Constraints

- With OIDC unset, upstream account/password behavior is unchanged.
- `members` policy stays in spaces.json. OIDC deployments may omit users.json.
- The implementation uses the workspace's existing `reqwest`, `jsonwebtoken`,
  `sha2`, and `base64` dependencies; it adds no crates.
- Trusted-header authentication is intentionally outside this branch.
