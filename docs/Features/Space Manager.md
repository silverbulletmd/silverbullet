---
references:
- bin/silverbullet/src/boot.rs
- server/src/multi/setup.rs
- server/src/multi/setup_api.rs
- server/src/multi/users.rs
- server/src/multi/config.rs
- server/src/multi/admin_api.rs
- server/src/multi/access.rs
- server/src/multi/space_index.rs
---
A single SilverBullet server can host any number of [[Concepts/Space|spaces]] — each with its own URL, access rules, and configuration — managed a web-based management UI called _Space Manager_.

# Setup wizard
When a server boots with an empty data folder it will run in setup mode. Setup mode has two steps:

1. **Account creation**: creates the first administrator account.
2. **Space creation**: creates your first space.

Once finished, the server writes `users.json` and `spaces.json` and redirects you to your newly created space. To return to the space manager, simply open the `/.spaces` URL, or select “All spaces” from the profile menu in the top bar.

# Accounts
Each account has a username, password, admin flag, any number of API tokens, and a profile — an optional full name and email used for attribution — which the account holder can edit themselves, or an admin can set on their behalf. See [[HTTP API#Accounts (multi-space mode)]] for the profile endpoints.

* **Admins** can reach the admin UI and manage spaces, accounts, and tokens. They can also log into *every* space.
* **Non-admin accounts** are ordinary users: they can log into any space they are a member of, and any space whose access level admits them (see [[#Access]]).

There is no self-service signup. Admins create accounts. There is no password recovery either, an admin sets a new password from the _Users_ tab. Fancier features like SSO integration etc may be implemented later.

# Spaces
Spaces have a name and point to a folder where its content is kept. By default this will be inside the SilverBullet data folder, but you can pick any folder you like.

## Bindings
Each space is reachable one of two ways:

* **URL prefix**: e.g. `/work`. A bare `/` binds a space at the root (allowed once). Prefixes must not overlap (`/work` and `/work/sub` can’t coexist, nor can two spaces both bind `/`).
* **Hostname**: e.g. `notes.example.com`, matched on the `Host` header of the main listener. Point wildcard DNS or per-host reverse-proxy rules at the server.

A host binding gives a space its own origin, which is what isolates it from other spaces in the browser — see [[Deployment/Security Profiles]] for when that matters.

## Access
Access to a space resolves to one of three levels:

| Level | Meaning |
| --- | --- |
| `none` | Not visible. Requests are refused. |
| `read` | May read content. May not modify anything, and may not reach any capability endpoint (shell, proxy, runtime API). |
| `write` | Full access to the space’s content and capabilities. |

`write` carries real trust — see [[Security#What `write` really means]].

The effective level for a request is the **maximum** of three independent sources:

| Source | Values |
| --- | --- |
| `access` — what a visitor with no session gets | `none` (default), `read`, `write` |
| `username.role` — what one account gets | absent (no access), `read`, `write` |
| admin | always `write`, on every space |

Taking the maximum is what makes this composable: `access: "read"` publishes a space to the world without touching the member list, and adding a `read`-role member to a private space grants exactly that one account visibility without promoting them to a writer.

# Space index
When no space is bound to the server root (`/`), opening `/` redirects to `/.spaces` instead of opening a space. Any account can log in there. Ordinary accounts see spaces with anonymous [[#Access|access]] and spaces where they are members; administrators see every space, plus the admin screens covered in [[#Admin UI]].

# Boot modes
On startup the server inspects the data folder, the `--single` flag, and legacy `SB_*` environment variables, then picks its run mode.

Detection rules:

1. **`spaces.json` present -> multi-space.** The folder is a configured multi-space server.
2. **`--single` command line flag -> single-space.** Forces single space mode. `silverbullet --single ./new-dir` gives you an instant single space, unauthenticated (unless `SB_USER` is set).
3. **A `SB_*` variable is set -> single-space.** Any of `SB_USER`, `SB_AUTH_TOKEN`, `SB_READ_ONLY`, `SB_NAME`, `SB_INDEX_PAGE`, `SB_URL_PREFIX`, and friends selects single-space mode, so existing deployments keep working untouched.
4. **The folder is non-empty -> single-space.** An existing notes folder is served as a single space, exactly as before.
5. **Empty folder, no flags, no legacy env -> setup wizard.** A brand-new server — or a server pointed at a folder that hasn’t been created yet — puts up the [[#Setup wizard]].

# Migrating a single-space server to accounts
To convert an existing [[#Single-space mode]] server (one folder of notes, configured by `SB_USER` etc.) into an account-managed space:

1. Stop the server.
2. Start it pointed at a **fresh, empty folder** (with none of the legacy `SB_*` variables set) so it boots into the [[#Setup wizard]].
3. In the wizard, create your admin account. On the space step, tick **“Use an existing folder on this server”** and point it at your existing notes folder (an absolute path, or one relative to the new server root).
4. Finish. Your notes are now served as a space, with accounts and the admin UI in front.

# Single-space mode
Single-space mode is the classic/soon legacy way to run a SilverBullet server: one folder, one space, configured entirely by environment variables. Pick it with `--single`, or simply by pointing the server at a folder that already has content (or by setting any legacy `SB_*` variable). See [[Features/Authentication#Single-space mode]] for its authentication options and [[Install/Configuration]] for the full environment-variable surface. If the target folder doesn’t exist yet, the server creates it and serves an empty space.

# Notes and limitations
* Spaces share one OS process and user. This mode is built for a household or team of trusted spaces, not hostile multi-tenancy.
* Authentication is shared across the server, while authorization remains per space. Password changes and account deletion revoke that user's sessions immediately; membership and admin-role changes also take effect on the next request.
* Because the session is server-wide, so is its policy: `SB_REMEMBER_ME_HOURS`, `SB_LOCKOUT_TIME`, and `SB_LOCKOUT_LIMIT` (see [[Install/Configuration#Authentication]]) apply to every space and to the space list itself, and are set as environment variables rather than per space in `spaces.json`.
* Shell commands (`shell.enabled`) are **off unless a space turns them on**. A `spaces.json` entry with no `shell` key — or with a `shell` object that sets only a `whitelist` — gets no shell, and an empty whitelist on an enabled space still means "any command". `SB_SHELL_BACKEND=off` remains a server-wide kill switch on top of that; it can only ever disable.
* The runtime API (`runtimeApi`) uses a single, server-wide headless Chrome with one page (tab) per enabled space. Both levels are lazy: the browser only starts on the first runtime request from any space, and a space only gets a tab on its own first request. It is on by default, but only actually runs when the server found a Chrome or Chromium install at startup — if it did not, the Space Manager says so and the per-space checkbox is locked. Set `SB_CHROME_PATH` to point at a browser in a non-standard location, or `SB_RUNTIME_API=0` to turn the whole surface off server-wide.
