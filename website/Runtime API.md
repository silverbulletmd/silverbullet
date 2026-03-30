#maturity/experimental

The Runtime API lets you interact with SilverBullet programmatically over HTTP — evaluate Lua expressions and run scripts from the command line, scripts, or external tools.

Requests are evaluated via Chrome DevTools Protocol (CDP) in a headless Chrome instance, which does the actual execution so all results reflect the live client state.

> **note** Note
> The [[CLI]] provides a convenient command-line interface for the Runtime API — evaluate Lua, run scripts, open a REPL, and more, without writing raw HTTP requests.

> **note** Note
> The Runtime API is not available in read-only mode (`SB_READ_ONLY`).

# Setup
The Runtime API is enabled automatically when Chrome or Chromium is detected on your system — no configuration needed.

If Chrome isn't auto-detected, set the path explicitly:
```
SB_CHROME_PATH=/usr/bin/chromium
```

To explicitly disable the Runtime API, set `SB_RUNTIME_API=0`.

# Docker setup
Use the `-runtime-api` Docker image variant, which includes Chromium:
```yaml
services:
  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet:latest-runtime-api
    environment:
      - SB_USER=me:secret        # optional
      - SB_AUTH_TOKEN=mytoken    # optional, for API auth
    volumes:
      - myspace:/space
    ports:
      - "3000:3000"
```

The `-runtime-api` image automatically persists the Chrome profile in `/space/.chrome-data`, avoiding re-indexing on container restarts.

The base Docker image (`ghcr.io/silverbulletmd/silverbullet`) does **not** include Chromium and is significantly smaller (~64MB vs ~766MB).

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

## Screenshot
`GET /.runtime/screenshot`

Captures the current viewport of the headless Chrome instance as a PNG image.

```bash
curl -o screenshot.png http://localhost:3000/.runtime/screenshot
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
All error responses are JSON with `Content-Type: application/json` and an `error` key:

* **400** — Empty request body: `{"error": "Request body is required"}`
* **500** — Lua execution error: `{"error": "<error message>"}`
* **503** — Runtime API not enabled or no headless browser running: `{"error": "No headless browser running"}`
* **504** — Timeout exceeded: `{"error": "Request timed out"}`

# How it works
As documented in [[Architecture]], the vast majority of SilverBullet’s power is implemented in the client. However, there are use cases for programmatically accessing your space with all of SilverBullet (client’s) power.

When the Runtime API is enabled, the server launches a headless (invisible by default) Chrome process upon the first request to an `/.remote` endpoint. This browser loads the full SilverBullet client, exactly like a regular browser tab, but without a visible window (with some memory optimizations). The client boots normally: it loads all plugs, Lua code and navigates to the index page.

Once ready, the server communicates with the browser directly via Chrome DevTools Protocol (CDP). Because Lua code runs inside a real SilverBullet client, it has access to the full API surface — `editor.*`, `space.*`, queries, and everything else available to in-page scripts and widgets. The results reflect live client state.

## Debugging
Set `SB_CHROME_SHOW=1` to run Chrome with a visible window — useful for watching what the headless client is doing. Set `SB_CHROME_DATA_DIR` to a path to persist the Chrome profile between restarts (avoids re-indexing on each restart).

## Resource usage
Headless Chrome spawns several processes (browser, network, storage, and renderer). With the full SilverBullet client loaded and indexed, expect roughly **150–200 MB** of total RSS across all Chrome processes. The SilverBullet server itself adds ~30 MB on top of this.
