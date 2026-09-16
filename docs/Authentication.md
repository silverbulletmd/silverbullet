---
tags: administration
references:
- bin/silverbullet/src/config.rs
- bin/silverbullet/src/server.rs
- server/src/multi/users.rs
- server/src/multi/access.rs
---
How you authenticate depends on how the server is running:

* **Multi-space mode (the default).** A “modern” install manages accounts and controls who can reach each space. This is the recommended setup — see [[#Accounts]].
* **Single-space mode.** One folder served as one space, authenticated by a single set of environment-variable credentials — see [[#Single-space mode]].
* **No authentication.** A single-space server with no credentials set is open to anyone who can reach it.

# Accounts
When the server runs in the default [[Dashboard|multi-space]] mode, authentication is account-based:

* Every person has an [[Account]] (username + password), set by an admin when creating the account.
* Each [[Space]] has an [[Dashboard#Access|access level]] — `none`, `read`, or `write` — for visitors with no account, plus per-member `read`/`write` roles. Admins can reach every space and the admin UI.
* Accounts, spaces, and access are all managed in the [[Dashboard]], which every account can open.
* Every space has a login page, including one that permits anonymous access.

# Single sign-on
Account-managed servers can connect Google Workspace, Pocket ID, or another OpenID Connect provider alongside local accounts. See [[Single Sign-On]] for web setup, user provisioning and central login.

# Single-space mode
Single-space mode serves one folder as one space, authenticated the “classic” way: a single set of credentials set via the `SB_USER` environment variable in `username:password` form.

> **warning** Warning
> Single-space is considered legacy, please migrate to multi-space mode

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
For programmatic access via the [[HTTP API]], you can use bearer token authentication. In single-space mode, this token is configured with an environment variable, see [[Install/Configuration]]. In multi-space mode, new API tokens can be issued via the [[Dashboard]] UI.

# Authentication proxies
Alternatively, or in addition, you can use an [[Authentication Proxy]] to delegate authentication to an external system (like Authelia, Authentik, or a reverse proxy's built-in auth). This is common in more complex self-hosted setups. In accounts mode, pair a proxy with **public** spaces so the proxy owns identity; in single-space mode, put the proxy in front of an open server.

For all authentication-related configuration options, see [[Install/Configuration#Authentication]].
