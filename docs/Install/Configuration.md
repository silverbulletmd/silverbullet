---
references:
- bin/silverbullet/src/config.rs
- bin/silverbullet/src/server.rs
---
While most of SilverBullet’s configuration happens through the [[Dashboard]] these days, a few options remain configurable via environment variables.

# Network
* `SB_HOSTNAME`: Set to the hostname to bind to (defaults to `127.0.0.0`, set to `0.0.0.0` to accept outside connections for the local setup, defaults to `0.0.0.0` for docker)
* `SB_PORT`: Sets the port to listen to, e.g. `SB_PORT=1234`, default is `3000`

# Docker
Configuration only relevant to docker deployments:

* `PUID`: Runs the server process with the specified UID (default: whatever user owns the `/data` mapped folder)
* `PGID`: Runs the server process with the specified GID (default: whatever group owns the `/data` mapped folder)\

# Runtime API
* `SB_CHROME_PATH`: Optional explicit path to the Chrome, Chromium, or headless-shell binary. Falls back to the `CHROMIUM_PATH` environment variable (pre-set in the default Docker image), then auto-detection, which prefers headless shell on `PATH`.
* `SB_CHROME_SHOW`: Set to any non-empty value to run Chrome with a visible window instead of headless (useful for debugging). Requires full Chrome/Chromium; auto-detection skips headless shell in this mode.
* `SB_CHROME_LOG_CONSOLE`: Forward the headless Chrome page’s `console.*` output to the server log (so you can see what the runtime is doing). Enabled by default; set to `0` to disable. The same log is also available via `/.runtime/logs` (e.g. `sb logs`).

# Metrics
SilverBullet offers a few basic Prometheus metrics, these can be configured with the following environment variables:

* `SB_METRICS_PORT`: HTTP port to expose metrics (under the default `/metrics` endpoint) on

# Legacy “single-space” mode options
> **warning** Warning
> Configuring SilverBullet in a single-space server setup with environment variables is now considered a **legacy** feature and **deprecated**.
>

The environment variables below configure a **single-space** server. A fresh install will run SilverBullet in multi-space mode and let you configure most options via the [[Dashboard]].

## General configuration
* `SB_FOLDER`: The data folder to serve, e.g. `SB_FOLDER=/home/user/silverbullet`. In single-space mode this folder is your space, in multi-space mode it holds the server configuration and (by default) the spaces, see [[Dashboard]].
* `SB_INDEX_PAGE`: Sets the default page to load, defaults to `index`.
* `SB_SPACE_IGNORE`: Hide paths from SilverBullet using gitignore-style patterns, e.g. `SB_SPACE_IGNORE="IgnoreMe/*"`. The space folder's actual `.gitignore` file is not read.
* `SB_HTTP_LOGGING`: Set to any value to enable HTTP logging
* `SB_LOG_PUSH`: Set to any value to ask clients to push their logs to the server (for debugging purposes)
* `SB_DISABLE_SERVICE_WORKER`: Set to any value to disable the client-side service worker for all clients. In this mode, [[Sync]] is disabled (so your space is not copied into the browser) and the app will not function when offline. All loads and saves will go directly to the server.
* `SB_FS_WATCH`: Controls how the server detects files changed on disk by other programs, for the whole server instance. `auto` (default) watches the space folder natively and pushes changes to open clients, so an externally edited page updates in the editor within moments. `poll` scans for changes instead — use it when the space lives on a network mount (NFS/SMB) where writes from *other* machines produce no native file-system events. `off` disables watching entirely: clients fall back to checking for changes periodically, as they did before this existed.
* `SB_FS_POLL_INTERVAL`: How often `SB_FS_WATCH=poll` scans, in whole seconds (default `30`). Only consulted in poll mode. Each scan re-checks every file in the space, so a short interval is expensive on a large space or a network mount; lower it only if you need external edits picked up faster than the default. Values that are not a positive whole number are ignored with a warning.

## Network
* `SB_UNIX_SOCKET`: Instead of listening to a TCP port, listen to a Unix socket at the specified path, e.g. `SB_UNIX_SOCKET=/tmp/silverbullet.sock`. Note: when this is set, `SB_HOSTNAME` and `SB_PORT` are ignored.
* `SB_URL_PREFIX`: Host SilverBullet on a particular URL prefix, e.g. `SB_URL_PREFIX=/notes`

## Authentication
* `SB_USER` (single-space only): Sets single-user credentials, e.g. `SB_USER=pete:1234` allows you to login with username “pete” and password “1234”.
* `SB_AUTH_TOKEN` (single-space only): Enables `Authorization: Bearer <token>` style authentication on the [[HTTP API]]. In multi-space mode this is replaced by per-account [[Dashboard#API tokens|API tokens]].
* `SB_LOCKOUT_LIMIT`: Specifies the number of failed login attempt before locking the user out (for a `SB_LOCKOUT_TIME` specified amount of seconds), defaults to `10`
* `SB_LOCKOUT_TIME`: Specifies the amount of time (in seconds) a client will be blocked until attempting to log back in, defaults to `60`.
* `SB_REMEMBER_ME_HOURS`: Sets the session duration in hours when "Remember me" is checked during login, defaults to 7 days. Sessions where "Remember me" was left unchecked always last one week.

## Run mode
* `SB_READ_ONLY`: If you want to run the SilverBullet client and server in read-only mode (you get the full SilverBullet client, but all edit functionality and commands are disabled), you can do this by setting this environment variable to a non-empty value. Upon the server start a full space index will happen, after which all write operations will be disabled.

## Web app manifest
Configure aspects of web app appearance as well as the authentication page:

* `SB_NAME`: Sets `name` and `short_name` members of web app manifest to whatever specified in `SB_NAME`
* `SB_DESCRIPTION`: Sets `description` member of web app manifest to whatever specified in `SB_DESCRIPTION`
