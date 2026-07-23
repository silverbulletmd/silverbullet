---
tags: getting-started
references:
- bin/silverbullet/src/config.rs
- bin/silverbullet/src/server.rs
- server/src/multi/users.rs
- server/src/multi/access.rs
---
How you authenticate depends on how the server is running (see [[Space Manager#Boot modes]]):

* **Accounts (the default).** A fresh install manages people through named accounts in `users.json` and controls who can reach each space. This is the recommended setup — see [[#Accounts]].
* **Single-space mode.** One folder served as one space, authenticated by a single set of environment-variable credentials — see [[#Single-space mode]].
* **No authentication.** A single-space server with no credentials set is open to anyone who can reach it.

# Accounts
When the server runs in the default [[Space Manager|multi-space]] mode, authentication is account-based:

* Every person has an **account** (username + password).
* Each [[Space]] is either **public** (no login) or requires login, and lists the **members** allowed in. Admins can reach every space and the admin UI.
* Accounts, spaces, and access are all managed in the `/.spaces` surface, which every account can open (admins additionally get the Users tab and space create/edit screens).
* When no space is bound to `/`, the server root provides an account-facing index of the spaces available to the current user.

# Single-space mode
[[Space Manager#Single-space mode|Single-space mode]] serves one folder as one space, authenticated the classic way: a single set of credentials set via the `SB_USER` environment variable in `username:password` form.

## Enabling authentication
Set `SB_USER` when starting the server. For the [[Install/Binary]]:

```shell
SB_USER=pete:1234 ./silverbullet my-space
```

For [[Install/Docker]]:

```shell
docker run -e SB_USER=pete:1234 ...
```

This allows `pete` to log in with password `1234`. When authentication is enabled, SilverBullet shows a login page on first access.

# API
For programmatic access via the [[HTTP API]], you can use bearer token authentication. In single-space mode, this token is configured with an environment variable, see [[Install/Configuration]]. In multi-space mode, new API tokens can be issued via the [[Space Manager]] UI.

# Authentication proxies
Alternatively, or in addition, you can use an [[Authentication Proxy]] to delegate authentication to an external system (like Authelia, Authentik, or a reverse proxy's built-in auth). This is common in more complex self-hosted setups. In accounts mode, pair a proxy with **public** spaces so the proxy owns identity; in single-space mode, put the proxy in front of an open server.

For all authentication-related configuration options, see [[Install/Configuration#Authentication]].
