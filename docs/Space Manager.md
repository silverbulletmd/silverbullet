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
A single SilverBullet server can host any number of [[Space|spaces]] — each with its own URL, access rules, and configuration — managed a web-based management UI called _Space Manager_.

# Setup wizard
When a server boots with an empty data folder it will run in set mode. Setup mode has two steps:

1. **Account creation**: creates the first administrator account.
2. **Space creation**: creates your first space.

Once finished, the server writes `users.json` and `spaces.json` and redirects you to your newly created space. To return to the space manager, simply open the `/.spaces` URL.

# Accounts
Each account has a username, password, admin flag and any number of API tokens.

* **Admins** can reach the admin UI and manage spaces, accounts, and tokens. They can also log into *every* space.
* **Non-admin accounts** are ordinary users: they can log into any space they are a member of (see [[#Access]]).

There is no self-service signup. Admins create accounts. There is no password recovery either, an admin sets a new password from the _Users_ tab. Fancier features like SSO integration etc may be implemented later.

# Spaces
Spaces have a name and point to a folder where its content is kept. By default this will be inside the SilverBullet data folder, but you can pick any folder you like.

## Bindings
Each space is reachable one of two ways:

* **URL prefix**: e.g. `/work`. A bare `/` binds a space at the root (allowed once). Prefixes must not overlap (`/work` and `/work/sub` can’t coexist, nor can two spaces both bind `/`).
* **Hostname**: e.g. `notes.example.com`, matched on the `Host` header of the main listener. Point wildcard DNS or per-host reverse-proxy rules at the server.

## Access
Each space controls who can read and write it through two fields:

* **`public`** — when true, no login is required. Anyone who can reach the URL can read *and edit* the space, so combine it with `readOnly` for a public wiki, or use it only behind an [[Authentication Proxy]]. When false (the default), the space requires a login.
* **`members`** — the accounts allowed to log into a non-public space. Admins are implicitly members of every space and don’t need listing.

# Space index
When no space is bound to the server root (`/`), opening `/` redirects to `/.spaces` instead of opening a space. Any account can log in there. Ordinary accounts see public spaces and spaces where they are members; administrators see every space, plus the admin screens covered in [[#Admin UI]].

# Boot modes
On startup the server inspects the data folder, the `--single` flag, and legacy `SB_*` environment variables, then picks its run mode.

Detection rules:

1. **`spaces.json` present -> multi-space.** The folder is a configured multi-space server.
2. **`--single` command line flag -> single-space.** Forces single space mode. `silverbullet --single ./new-dir` gives you an instant single space, unauthenticated (unless `SB_USER` is set).
3. **A `SB_*` variable is set -> single-space.** Any of `SB_USER`, `SB_AUTH_TOKEN`, `SB_READ_ONLY`, `SB_NAME`, `SB_INDEX_PAGE`, `SB_URL_PREFIX`, and friends selects single-space mode, so existing deployments keep working untouched.
4. **The folder is non-empty -> single-space.** An existing notes folder is served as a single space, exactly as before.
5. **Empty folder, no flags, no legacy env -> setup wizard.** A brand-new server — or a server pointed at a folder that hasn’t been created yet — puts up the [[#Setup wizard]].

# Programmatic setup
You can provision a server without the browser wizard. Both paths run the same logic and refuse to run twice (once `users.json` exists).

**CLI `setup` subcommand**:
```shell
silverbullet setup /var/lib/silverbullet \
  --admin admin:s3cretpw \
  --space "Notes" --at / --space-folder spaces/notes
```

* `--admin user:pass` (required) creates the admin account.
* `--space NAME` creates a first space (omit to create none).
* `--at` is its binding (`/` for the root, or a prefix like `/notes`; default `/`).
* `--space-folder` is where its files live (default `spaces/<id>`).

**HTTP setup API**: while a server is in setup mode, `POST /.setup/api/complete` accepts the same payload the wizard sends:

```json
{
  "adminUsername": "admin",
  "adminPassword": "s3cretpw",
  "space": { "name": "Notes", "prefix": "/", "folder": "" }
}
```

`GET /.setup/api/status` reports the server's absolute data root, which the wizard uses to prepopulate the folder field. On success the server hot-swaps into the multi-space stack, just like the wizard.

# Migrating a single-space server to accounts
To convert an existing [[#Single-space mode]] server (one folder of notes, configured by `SB_USER` etc.) into an account-managed space:

1. Stop the server.
2. Start it pointed at a **fresh, empty folder** (with none of the legacy `SB_*` variables set) so it boots into the [[#Setup wizard]].
3. In the wizard, create your admin account. On the space step, tick **“Use an existing folder on this server”** and point it at your existing notes folder (an absolute path, or one relative to the new server root).
4. Finish. Your notes are now served as a space, with accounts and the admin UI in front.

Nothing in your old notes folder is modified beyond seeding an index page if one is missing.

# Single-space mode
Single-space mode is the “classic” SilverBullet server: one folder, one space, configured entirely by environment variables, with no `spaces.json`, `users.json`, nor admin UI. Pick it with `--single`, or simply by pointing the server at a folder that already has content (or by setting any legacy `SB_*` variable). See [[Authentication#Single-space mode]] for its authentication options and [[Install/Configuration]] for the full environment-variable surface. If the target folder doesn’t exist yet, the server creates it and serves an empty space.

# Notes and limitations
* Spaces share one OS process and user. This mode is built for a household or team of trusted spaces, not hostile multi-tenancy.
* Authentication is shared across the server, while authorization remains per space. Password changes and account deletion revoke that user's sessions immediately; membership and admin-role changes also take effect on the next request.
* The runtime API (`runtimeApi`) launches one headless Chrome per enabled space, lazily; it is off by default.
