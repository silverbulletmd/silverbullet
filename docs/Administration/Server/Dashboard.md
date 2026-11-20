---
tags: administration
references:
- bin/silverbullet/src/boot.rs
- server/src/multi/setup.rs
- server/src/multi/setup_api.rs
- server/src/multi/users.rs
- server/src/multi/config.rs
- server/src/multi/admin_api.rs
- server/src/multi/access.rs
- server/src/multi/dashboard.rs
---
A single SilverBullet server can host any number of [[Reference/Concepts/Space|spaces]] — each with its own URL, access rules, and configuration — managed through a web-based dashboard.

# Setup wizard
When a server boots with an empty data folder it will run in setup mode. Setup mode has two steps:

1. **Account creation**: creates the first administrator account.
2. **Space creation**: creates your first space, starting from one of the [[Starter Kits]] (Personal space by default) or a public Git repository.

When the data folder has a `spaces.json` but no `users.json`, the setup wizard runs to create an administrator and keeps the existing spaces. See [[Administration/Server/Configuration#Data folder]] for what the data folder holds.

# Servers without accounts
A server whose `users.json` contains just `{}` has no accounts, so nobody can sign in. Its spaces are reachable only according to their [[#Access|access]] setting, and the Dashboard shows a “No accounts” notice instead of a login. You configure such a server by editing `spaces.json` while it is stopped. A missing `users.json` is different: it means setup, and the server runs the setup wizard to create an administrator.

# Accounts
![[Account]]
# Spaces
Spaces have a name and point to a folder where its content is kept. By default this will be inside the SilverBullet data folder, but you can pick any folder you like.

**New space** opens with a gallery of [[Starter Kits]] (Personal space, Team space, Blank space) and **From a Git repository**, which copies a public repository once or keeps the space in sync with it. Pointing it at a folder that already has notes creates the space without adding starter content.

**Space settings → General → Remove space** removes a space from the server and keeps its files on disk. Tick **Also delete all my files** to permanently delete the space's folder and everything in it as well; this cannot be undone. The server refuses to delete a folder that holds its own data (a space at `.`) or overlaps another space's folder; remove such a space without deleting its files and clean up by hand.

## Bindings
Each space has a public address composed from a hostname and a path (which can be `/`).

The setup wizard, **New space**, and **Space settings → General** use the same address editor. Choose the primary host, a previously configured custom hostname or `hostname:port`, or **New hostname**, then choose a path.

## Access
Access to a space can be configured to one of three levels:

* **`none`:** Not visible, no access.
* **`read`:** May read content. May not modify anything, and may not reach any capability endpoint (shell, proxy, runtime API).
* **`write`:** Full access to the space’s content and capabilities.

`write` carries real trust — see [[Security#What `write` really means]].

The effective level for a request is the **maximum** of three independent sources:

* **`access` — what a visitor with no session gets:** `none` (default), `read`, `write`.
* **`username.role` — what one account gets:** absent (no access), `read`, `write`.
* **admin:** always `write` on every space.
# Dashboard access
When no space is bound to the server root (`/`), opening `/` redirects to `/.dashboard` instead of opening a space. Any account can log in there. Ordinary accounts see spaces with anonymous [[#Access|access]] and spaces where they are members, administrators see every space, plus two more sections: **Settings** holds server-wide settings (server name and address, sign-in, the search model, the [[Integrations/Runtime API]] and [[Integrations/MCP]]), and **Status** shows what is happening: active runtimes, every account’s connected MCP apps, each space’s search indexes with Rebuild, and the Git sync state of every space that syncs with a repository.

The Dashboard lives at the root of the server, under `/.dashboard` and `/.instance`. If a reverse proxy forwards only a space’s path, also forward these paths to reach the Dashboard.
