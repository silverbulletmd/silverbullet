---
description: "Accounts and login options for SilverBullet Server."
tags: administration
references:
- server/src/multi/users.rs
- server/src/multi/access.rs
---
SilverBullet Server authenticates people with accounts, managed in the [[Dashboard]]. Each space decides what visitors without an account may do.

# Accounts
Authentication is account-based:

* Each member has an [[Account]], provisioned by an administrator with local credentials or [[Single Sign-On]].
* Each [[Reference/Concepts/Space]] has an [[Dashboard#Access|access level]] — `none`, `read`, or `write` — for visitors with no account, plus per-member `read`/`write` roles. Admins can reach every space and the admin UI.
* Accounts, spaces, and access are all managed in the [[Dashboard]], which every account can open.
* Every space has a login page, including one that permits anonymous access.

# Staying signed in
A browser stays signed in as long as you use it: every visit extends the session, and it only ends after 30 days without use (configurable with `SB_SESSION_DAYS`, see [[Administration/Server/Configuration#Authentication]]). Changing your password, disabling the account, or signing out ends it right away.

On a computer other people use, tick **Shared computer** when you log in. The session then ends when the browser closes (or after 12 hours without use), and nothing is kept on the device: no offline copy, no service worker, no local index. Pages load from the server each time, so this mode needs a connection and starts a little slower on large spaces.

# Single sign-on
Account-managed servers can connect Google Workspace, Pocket ID, or another OpenID Connect provider alongside local accounts. See [[Single Sign-On]] for web setup, user provisioning and central login.

# Servers without accounts
A server whose `users.json` contains just `{}` has no accounts, so nobody can sign in, and its spaces are reachable only according to their access setting. See [[Dashboard#Servers without accounts]].

# API
For programmatic access via the [[Integrations/HTTP API]], you can use bearer token authentication with an API token issued in the [[Dashboard]].

# Authentication proxies
Alternatively, or in addition, you can use an [[Authentication Proxy]] to delegate authentication to an external system (like Authelia, Authentik, or a reverse proxy’s built-in auth). This is common in more complex self-hosted setups. Pair a proxy with **public** spaces so the proxy owns identity.

For all authentication-related configuration options, see [[Administration/Server/Configuration#Authentication]].
