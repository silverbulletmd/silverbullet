---
references:
- bin/silverbullet/src/config.rs
- bin/silverbullet/src/server.rs
- server/src/multi/config.rs
- server/src/multi/server_config.rs
- bin/silverbullet/src/multi.rs
---
While most of SilverBullet’s configuration happens through the [[Dashboard]], a few options remain configurable via environment variables.

# General
* `SB_FOLDER`: The data folder, e.g. `SB_FOLDER=/home/user/silverbullet`, when it isn’t passed as an argument. It holds the server configuration and, by default, the spaces. See [[#Data folder]]. For `silverbullet publish`, it is the folder to publish instead, see [[Publishing#Publish a folder as a website]].
* `SB_DISABLE_SERVICE_WORKER`: Set to any value to disable the client-side service worker for all clients. In this mode, [[Features/Sync]] is disabled (so your space is not copied into the browser) and the app will not function when offline. All loads and saves will go directly to the server.
* `SB_FS_WATCH`: Controls how the server detects files changed on disk by other programs, for the whole server instance. `auto` (default) watches the space folder natively and pushes changes to open clients, so an externally edited page updates in the editor within moments. `poll` scans for changes instead — use it when the space lives on a network mount (NFS/SMB) where writes from *other* machines produce no native file-system events. `off` disables watching entirely: clients fall back to checking for changes periodically, as they did before this existed.
* `SB_FS_POLL_INTERVAL`: How often `SB_FS_WATCH=poll` scans, in whole seconds (default `30`). Only consulted in poll mode. Each scan re-checks every file in the space, so a short interval is expensive on a large space or a network mount. Lower it only if you need external edits picked up faster than the default. Values that are not a positive whole number are ignored with a warning.

# Data folder
The data folder holds the server’s configuration and, by default, its spaces:

* `spaces.json`: every space, with its address, folder, access, members and settings.
* `users.json`: the accounts. A file containing just `{}` makes a server without accounts, see [[Dashboard#Servers without accounts]].
* `server.json`: server-wide settings from the administrator’s screens in the [[Dashboard]], such as the [[Integrations/Runtime API]], [[Integrations/MCP]] and the semantic [[Features/Search]] model.
* `spaces/`: the space folders created in the Dashboard. A space can also point to a folder elsewhere.
* `search/`: the [[Features/Search]] indexes.
* `.chrome-data`: the [[Integrations/Runtime API]]’s browser profiles.

When the server starts with an empty data folder, it runs the setup wizard, see [[Dashboard#Setup wizard]]. Keep the data folder on persistent storage, and back it up as a whole.

Configure spaces in the [[Dashboard]]. Settings it doesn’t show, such as a space’s description, head HTML, theme colour, ignore patterns and log push, go in the space’s entry in `spaces.json`. Edit it while the server is stopped.

# Network
* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.1`, set to `0.0.0.0` to accept outside connections for the local setup, defaults to `0.0.0.0` for docker and for `silverbullet publish`, see [[Publishing#Publish a folder as a website]])
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`, default is `3000`
* `SB_UNIX_SOCKET`: Instead of listening to a TCP port, listen to a Unix socket at the specified path, e.g. `SB_UNIX_SOCKET=/tmp/silverbullet.sock`. This applies to the setup wizard and the running server. When this is set, `SB_HOSTNAME` and `SB_PORT` are ignored.

# Authentication
These apply to every space and the [[Dashboard]]. Accounts and [[Authentication#API|API tokens]] are managed in the Dashboard.

* `SB_LOCKOUT_LIMIT`: Specifies the number of failed login attempt before locking the user out (for a `SB_LOCKOUT_TIME` specified amount of seconds), defaults to `10`
* `SB_LOCKOUT_TIME`: Specifies the amount of time (in seconds) a client will be blocked until attempting to log back in, defaults to `60`.
* `SB_SESSION_DAYS`: How many days a browser session stays signed in without being used, defaults to `30`. Every visit extends it, so you stay signed in as long as you come back within this window. Sessions started with “Shared computer” end when the browser closes, or after 12 hours without use. See [[Authentication#Staying signed in]].
* `SB_REMEMBER_ME_HOURS` (deprecated): Used as the session length, in hours, when `SB_SESSION_DAYS` is not set. Switch to `SB_SESSION_DAYS`.

# Docker
Configuration only relevant to docker deployments:

* `PUID`: Runs the server process with the specified UID (default: whatever user owns the `/data` mapped folder)
* `PGID`: Runs the server process with the specified GID (default: whatever group owns the `/data` mapped folder)\

# Runtime API
* `SB_CHROME_PATH`: Optional explicit path to the Chrome, Chromium, or headless-shell binary. Falls back to the `CHROMIUM_PATH` environment variable (pre-set in the default Docker image), then auto-detection, which prefers headless shell on `PATH`.
* `SB_CHROME_SHOW`: Set to any non-empty value to run Chrome with a visible window instead of headless (useful for debugging). Requires full Chrome/Chromium. Auto-detection skips headless shell in this mode.
* `SB_CHROME_LOG_CONSOLE`: Forward the headless Chrome page’s `console.*` output to the server log. Enabled by default. Set to `0` to disable. The same log is also available via `/.runtime/logs` (e.g. `sb logs`).

# Metrics
SilverBullet offers a few basic Prometheus metrics, these can be configured with the following environment variables:

* `SB_METRICS_PORT`: HTTP port to expose metrics (under the default `/metrics` endpoint) on

# Update check
Server checks about once a day whether a newer SilverBullet release exists and whether the version you run has a known security issue. [[Features/Desktop]] doesn’t run this check.

* `SB_UPDATE_CHECK`: Set to `0` (or `false` or `off`) to turn the update check off. It is on by default.

**What is sent.** Every 24 hours, give or take up to 2 hours of random jitter, the Server makes one request:

```
GET https://silverbullet.md/api/server/update-check?v=<version>&os=<os>&arch=<arch>&kind=<kind>
User-Agent: SilverBullet-Server/<version>
```

**What admins see.** In the [[Dashboard]], admins see a red warning on every page when the running version has a known security issue, with the version to update to and a link to the details. It cannot be dismissed. Otherwise, a small notice appears when a newer stable release is available (on an [edge build](https://github.com/silverbulletmd/silverbullet/releases/tag/edge): a newer edge build). Admins can hide it with its × until the next release, or on edge until the following week.
