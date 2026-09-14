---
tags: maturity/experimental administration
references:
- bin/silverbullet/src/server.rs
- bin/sb/src/commands/query.rs
---
The Runtime API lets you interact with a SilverBullet client programmatically via HTTP.

Requests are evaluated via Chrome DevTools Protocol (CDP) in a headless Chrome instance, which does the actual execution so all results reflect the live client state.

> **note** Note
> The [[CLI]] provides a convenient command-line interface for the Runtime API — evaluate Lua, run scripts, and more, without writing raw HTTP requests.

# Setup
The Runtime API is enabled automatically when Chrome, Chromium, or Chromium headless shell is detected on your system — no configuration needed. Auto-detection prefers headless shell when it is available on `PATH`.

If Chrome is not auto-detected, for some reason, set the path explicitly:
```
SB_CHROME_PATH=/usr/bin/chromium
```

In single-instance mode, set `SB_RUNTIME_API=0` to disable the Runtime API. In multi-space mode this variable is ignored: use the **Enable runtime API** toggle in the administrator’s **Server** tab. Each writer has an independent **Runtime API** permission in the space’s access grid. Existing writers default to enabled unless explicitly opted out.

# Docker setup
The default Docker image includes Chromium headless shell, so no special image variant is required:
```yaml
services:
  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet:latest
    environment:
      - SB_USER=me:secret        # optional
      - SB_AUTH_TOKEN=mytoken    # optional, for API auth
    volumes:
      - myspace:/space
    ports:
      - "3000:3000"
```

The image stores isolated temporary Chrome profiles under `/space/.chrome-data`. A new runtime receives a fresh profile and rebuilds its client index; profiles are removed on Reset, permission revocation, or server shutdown. Administrative Stop retains the profile for reuse within the current server lifetime.

Use a `-slim` tag such as `latest-slim` if you do not need the Runtime API and want a smaller image without Chromium. The old `-runtime-api` tags remain available as compatibility aliases for the default image.

# Endpoints

## Evaluate a Lua expression
`POST /.runtime/lua`

The request body is a raw Lua expression as plain text.

```bash
curl -d '1 + 1' http://localhost:3000/.runtime/lua
# => {"result":2}
```

```bash
curl -d 'editor.getCurrentPage()' http://localhost:3000/.runtime/lua
# => {"result":"index"}
```

## Evaluate a Lua script
`POST /.runtime/lua_script`

The request body is a raw Lua script as plain text. This allows multi-statement scripts with explicit `return` statements.

```bash
curl -d 'local pages = query[[from tags.page limit 3 select table.select(_, "name")]]
return pages' \
     http://localhost:3000/.runtime/lua_script
# => {"result":[{"name":"index"},{"name":"Projects"},{"name":"TODO"}]}
```

## Console logs
`GET /.runtime/logs`

Returns recent console log entries from the headless browser.

| Query parameter | Description |
|---|---|
| `limit` | Maximum number of entries to return (default: 100, server retains up to 1000) |
| `since` | Unix millisecond timestamp — only return entries newer than this |

```bash
curl http://localhost:3000/.runtime/logs?limit=5
```

**Response:** `Content-Type: application/json`
```json
{
  "logs": [
    {"level": "log", "text": "[Client] Booting SilverBullet client", "timestamp": 1710000000000},
    {"level": "info", "text": "Service worker disabled.", "timestamp": 1710000000050}
  ]
}
```

Each entry has:
* `level` — one of `log`, `info`, `warn`, `error`, `debug`
* `text` — the concatenated console message
* `timestamp` — unix milliseconds when the entry was captured

# Timeout
The Lua endpoints (`/.runtime/lua` and `/.runtime/lua_script`) support an `X-Timeout` header to control the maximum wait time in seconds (default: 30):

```
curl -H "X-Timeout: 60" \
     -d 'some_long_running_expression()' \
     http://localhost:3000/.runtime/lua
```

# Error handling
All error responses are JSON with `Content-Type: application/json` and an `error` key. Runtime execution failures also include a stable machine-readable `code`.

Status codes used across the Runtime API:

* **403** — The caller lacks Write or Runtime API permission.
* **400** — Empty request body: `{"error": "Request body is required"}`.
* **500** — Lua/JS execution error (the evaluated code threw, e.g. a Lua error): `{"error": "<error message>", "code": "script_error"}`. The message is the concise client error (e.g. `attempt to call a nil value`); the full stack is available in the runtime console log.
* **503** — Runtime API not enabled or no headless browser running: `{"error": "Runtime API is not enabled"}` or `{"error": "...", "code": "bridge_unavailable"}`.
* **504** — Timeout exceeded: `{"error": "...", "code": "timeout"}`.

# How it works
As documented in [[Architecture]], the vast majority of SilverBullet’s power is implemented in the client. However, there are use cases for programmatically accessing your space with all of SilverBullet (client’s) power.

When the Runtime API is enabled, the first request to an `/.runtime/` endpoint starts a separate headless Chrome process for that user and space. Each runtime has its own temporary profile, cookies, browser storage, and console log. It loads the full SilverBullet client with the originating user’s identity and permissions. Removing Write or runtime access, disabling the account, or switching runtime off stops the affected browser and invalidates its credentials.

Once ready, the server communicates with the browser directly via Chrome DevTools Protocol (CDP). Because Lua code runs inside a real SilverBullet client, it has access to the full API surface — `editor.*`, `space.*`, queries, and everything else available to in-page scripts and widgets. The results reflect live client state.

## Debugging
Set `SB_CHROME_SHOW=1` to run Chrome with a visible window — useful for watching what the headless client is doing. Set `SB_CHROME_DATA_DIR` to choose the parent directory for isolated temporary profiles. Startup logs report the detected Chrome executable or that Chrome is unavailable.

## Resource usage
Headless Chrome spawns several processes (browser, network, storage, and renderer) for each active user and space pair. Additional runtimes therefore cost a whole browser, not just a tab. Browsers start lazily so unused runtime permissions consume no Chrome processes.

## Managing runtimes
Server administrators can open **Admin → Runtimes** to see each instantiated runtime's space, user, status, CPU, estimated memory, and profile disk usage. The list refreshes while visible and includes stopped runtimes with retained profiles. Viewing it does not start Chrome.
