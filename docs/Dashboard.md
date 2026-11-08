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
The access selector offers three roles, plus **No access**:

| Role | Stored value | Permissions |
|---|---|---|
| Reader | `read` | Read pages and use their queries and installed widgets. |
| Editor | `edit` | Also edit ordinary pages and attachments. Cannot change `Library/` or root `CONFIG.md`, install libraries or use shell, proxy or Runtime API endpoints. |
| Builder | `write` | Also change configuration, install libraries and author executable extensions. |

Existing `write` grants remain **Builder** grants; they are not downgraded to Editor. Grant Builder only to trusted people: their installed code runs for other visitors. See [[Security]]. Runtime API access also requires its separate member permission and server availability. Freezing a space suspends writes for everyone, including admins.

The effective level is the **maximum** of the public `access` setting (`none`, `read`, `edit`, `write`), the account’s member `role` (`read`, `edit`, `write`), and administrator access (always Builder). A Reader membership does not lower public Editor access.

# Dashboard access
When no space is bound to the server root (`/`), opening `/` redirects to `/.dashboard` instead of opening a space. Any account can log in there. Ordinary accounts see spaces with anonymous [[#Access|access]] and spaces where they are members, administrators see every space, plus the admin screens.