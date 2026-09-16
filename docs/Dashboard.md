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
A single SilverBullet server can host any number of [[Space|spaces]] — each with its own URL, access rules, and configuration — managed through a web-based dashboard.

# Setup wizard
When a server boots with an empty data folder it will run in setup mode. Setup mode has two steps:

1. **Account creation**: creates the first administrator account.
2. **Space creation**: creates your first space.

# Accounts
![[Account]]
# Spaces
Spaces have a name and point to a folder where its content is kept. By default this will be inside the SilverBullet data folder, but you can pick any folder you like.

## Bindings
Each space has a public address composed from a hostname and a path (which can be `/`).

The setup wizard, **Create space**, and **Space settings → General** use the same address editor. Choose the primary host, a previously configured custom hostname or `hostname:port`, or **New hostname**, then choose a path.

## Access
Access to a space can be configured to one of three levels:

| Level | Meaning |
| --- | --- |
| `none` | Not visible, no access. |
| `read` | May read content. May not modify anything, and may not reach any capability endpoint (shell, proxy, runtime API). |
| `write` | Full access to the space’s content and capabilities. |

`write` carries real trust — see [[Security#What `write` really means]].

The effective level for a request is the **maximum** of three independent sources:

| Source | Values |
| --- | --- |
| `access` — what a visitor with no session gets | `none` (default), `read`, `write` |
| `username.role` — what one account gets | absent (no access), `read`, `write` |
| admin | always `write` on every space |

# Dashboard access
When no space is bound to the server root (`/`), opening `/` redirects to `/.dashboard` instead of opening a space. Any account can log in there. Ordinary accounts see spaces with anonymous [[#Access|access]] and spaces where they are members, administrators see every space, plus the admin screens.