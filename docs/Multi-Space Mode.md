---
tags: maturity/beta
references:
- bin/silverbullet/src/multi.rs
- server/src/multi/config.rs
- server/src/multi/validate.rs
- server/src/multi/dispatch.rs
- server/src/multi/admin_api.rs
- server/src/multi/listeners.rs
- server/src/auth/cookie.rs
---

Multi-space mode lets a single SilverBullet server host any number of [[Space|spaces]], each with its own URL, authentication, and configuration,  replacing a fleet of separate server processes with one process, one config file, and one admin UI.

# Enabling
Multi-Space is a server wide mode that is disabled by default it. By setting the `SB_MULTI_SPACE=1` you enable it. In this mode setting up SB_USER-bsed authentication (used for the admin account) is mandatory.

For instance:

```shell
SB_MULTI_SPACE=1 SB_USER=admin:s3cret silverbullet /var/lib/silverbullet
```

Notes:
* `SB_USER` is **required**: it becomes the admin credential for the management UI (and the default credential for spaces using `inherit` auth).
* The folder passed in holds `spaces.json` (all space configs), the admin auth state, and, potentially the space folders themselves under `spaces/` (although folders outside this folder can be configured as well).
* `SB_HOSTNAME`/`SB_PORT` configure the main listener. Space-level variables like `SB_READ_ONLY` or `SB_NAME` are ignored in this mode: those settings live per space.

On first start no spaces exist: visiting `/` redirects to the admin UI at `/.admin/`, where you log in with the `SB_USER` credentials and create your first space.

# Bindings
Each space is reachable one of three ways:
* **URL prefix**: e.g. `/work` on the main listener. The prefix must contain at least one path segment (a bare `/` is not allowed) and prefixes must not overlap (`/work` and `/work/sub` cannot coexist); prefixes starting with `/.` are reserved.
* **Hostname**: e.g. `notes.example.com`, matched on the `Host` header of the main listener. Point wildcard DNS or per-host reverse-proxy rules at the server.
* **Port**: a dedicated port, bound and released live as you add/remove spaces.

# Per-space authentication
Every space has an auth mode:
* **inherit** (default): the space accepts the admin credentials. Because it inherits the full admin credential set, it also accepts the admin `SB_AUTH_TOKEN` as a bearer token for API access.
* **custom**: a space-specific username and password. Passwords are stored as hashes in `spaces.json`. There is no password recovery, just set a new password from the admin UI if lost.
* **none**: an open space, e.g. a public read-only wiki (be sure to enabled “read only” mode for these).

Session cookies are scoped per space, so logging into one space never affects another, even on the same hostname.

# The spaces.json format
`spaces.json` maps a generated ID to each space's configuration. It is managed by the admin UI, but hand-editing is fine while the server is stopped (changes on disk are read at startup). All single-space server settings have per-space equivalents: `readOnly`, `shell`, `runtimeApi` (off by default here), `indexPage`, `description`, `themeColor`, `headHtml`, `spaceIgnore`, `logPush`.

```json
{
  "8b1c9e4e-…": {
    "name": "Work notes",
    "folder": "spaces/8b1c9e4e-…",
    "binding": { "prefix": "/work" },
    "auth": { "mode": "inherit" },
    "readOnly": false
  }
}
```

Deleting a space from the admin UI removes it from this file only, files on disk are never deleted.

# Notes and limitations
* Multi-space mode always requires admin authentication, there is no open variant.
* Spaces share one OS process and user: this mode is built for a household/team of trusted spaces, not hostile multi-tenancy.
* The runtime API (`runtimeApi`) launches one headless Chrome per enabled space, lazily, it is off by default.
