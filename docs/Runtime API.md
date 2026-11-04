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

> **note** Note
> Searching the space does not need the Runtime API: see [[HTTP API#Search]].

# Setup
The Runtime API is enabled automatically when Chrome, Chromium, or Chromium headless shell is detected on your system — no configuration needed. Auto-detection prefers headless shell when it is available on `PATH`.

If Chrome is not auto-detected, for some reason, set the path explicitly:
```
SB_CHROME_PATH=/usr/bin/chromium
```

In single-instance mode, set `SB_RUNTIME_API=0` to disable the Runtime API, and `SB_RUNTIME_IDLE_TIMEOUT` to change when an idle runtime stops (see [[#Idle stop]]). In multi-space mode these variables are ignored: use the **Enable runtime API** toggle in the administrator’s **APIs** tab. Each writer has an independent **Runtime API** permission in the space’s access grid. Existing writers default to enabled unless explicitly opted out.

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
      - ./data:/data
    ports:
      - "3000:3000"
```

The image stores Chrome profiles under `/data/.chrome-data`: one per user of each space. See [[#Profiles]].

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
curl -d 'local pages = query[[from p = index.pages() limit 3 select {name = p.name}]]
return pages' \
     http://localhost:3000/.runtime/lua_script
# => {"result":[{"name":"index"},{"name":"Projects"},{"name":"TODO"}]}
```

## Screenshot
`GET /.runtime/screenshot`

Captures the runtime client as a PNG image, after fonts have loaded and pending rendering has settled.

* `selector`: Optional CSS selector. The first matching element is scrolled into view and the image is clipped to it.
* `fullPage`: `1` or `true` captures the whole page instead of the viewport: the editor is scrolled one screen at a time, each screen is rendered and captured, and the screens are stitched into one PNG. The scroll position is restored afterwards. Cannot be combined with `selector` (400, code `invalid_request`).

```bash
curl -o page.png http://localhost:3000/.runtime/screenshot
curl -o top.png 'http://localhost:3000/.runtime/screenshot?selector=%23sb-top'
curl -o full.png 'http://localhost:3000/.runtime/screenshot?fullPage=1'
```

A full-page image stops at about 12000 CSS pixels. When the page is longer, the response carries `X-Screenshot-Truncated: true`. A long page can take several seconds to capture, so raise `X-Timeout` if needed.

Navigate first with the Lua endpoint, e.g. `editor.navigate("Projects")`. On SilverBullet Desktop, the runtime is the space’s visible editor window: the screenshot shows what the user sees, and fails while that window is minimized or hidden.

## Console logs
`GET /.runtime/logs`

Returns recent console log entries from the headless browser.

* `limit`: Maximum number of entries to return (default: 100, server retains up to 1000)
* `since`: Unix millisecond timestamp — only return entries newer than this

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
The Lua endpoints (`/.runtime/lua` and `/.runtime/lua_script`) and `/.runtime/screenshot` support an `X-Timeout` header to control the maximum wait time in seconds (default: 30):

```
curl -H "X-Timeout: 60" \
     -d 'some_long_running_expression()' \
     http://localhost:3000/.runtime/lua
```

# Waiting for the index
The Lua endpoints and `/.runtime/screenshot` can first wait until the space’s index has caught up with recent file changes (edits made through the [[HTTP API]], a script or another device), so a query sees a page written a moment ago. Send `X-Await-Index: 1` (`true` and `yes` also count). The server waits for its file watcher to pass changes on, then for the client’s index queue to empty, for at most the smaller of 5 seconds and `X-Timeout`. The request then runs with its full `X-Timeout`.

`POST /.search/query` (see [[HTTP API#Search]]) honours the same header: a signed-in member’s query first waits, for at most the smaller of 5 seconds and `X-Timeout`, until the search index has caught up with recent file changes. Public visitors’ queries do not wait and get `X-Index-Status: unknown`.

The response carries `X-Index-Status`, only when the request had `X-Await-Index`:

* `caught-up`: the index reflects every change the server knows of.
* `behind`: changes were still being indexed when the wait ended, so results may miss the latest edits.
* `polling`: the space polls for file changes instead of watching, so edits made outside SilverBullet since the last poll may not be indexed yet.
* `unknown`: the server could not tell, for example without a runtime.

```bash
curl -i -H "X-Await-Index: 1" -d 'index.pages()' http://localhost:3000/.runtime/lua
```

The [[CLI]] (`sb lua`, `sb query`, `sb screenshot`, `sb fs read --rendered` and `sb search`) and the [[MCP]] (`lua`, `screenshot`, `read` with `rendered`, and `search`) send it on every call and report `behind` and `polling` as a note.

# Results
The `result` of `/.runtime/lua` and `/.runtime/lua_script` (and the output of `sb lua` and `sb query`) is always plain JSON:

* `nil`, a missing query column: `null`. Keys are kept, so a row lacking `rating` reads `"rating": null`.
* `-0`: `0`
* `NaN`, `Infinity`, `-Infinity`: the strings `"NaN"`, `"Infinity"`, `"-Infinity"`
* Big integer: a number if it is a safe integer, else a decimal string
* Table with only keys `1..n`: array
* Any other table (including mixed tables): object, with sequence keys converted to `"1"`, `"2"`, …
* Date: ISO 8601 string
* Map / Set: object / array
* Query collection, such as `index.pages("book")` or `index.tags()`: array of all its rows, also when nested in a table. At most 1000 rows: a larger collection ends with one extra string, `"<truncated: N more rows; use sb query with where/limit>"`.
* Promise: awaited, also when nested

Values with no JSON form appear as string markers: `"<function>"`, `"<symbol>"`, `"<binary: N bytes>"`, `"<cycle>"` for a self-reference, `"<max depth>"` beyond 200 levels, `"<error: message>"`, and `"<ClassName>"` for other class instances.

```bash
curl -d 'return {f = print, n = 0/0, d = Date(0)}' http://localhost:3000/.runtime/lua_script
# => {"result":{"f":"<function>","n":"NaN","d":"1970-01-01T00:00:00.000Z"}}
```

# Error handling
All error responses are JSON with `Content-Type: application/json` and an `error` key. Runtime execution failures also include a stable machine-readable `code`.

Status codes used across the Runtime API:

* **403** — The caller lacks Write or Runtime API permission.
* **400** — Empty request body: `{"error": "Request body is required"}`. Invalid screenshot selector syntax: `{"error": "...", "code": "invalid_selector"}`.
* **404** — No visible element matches the screenshot selector: `{"error": "...", "code": "selector_not_found"}`.
* **500** — Lua/JS execution error (the evaluated code threw, e.g. a Lua error): `{"error": "<error message>", "code": "script_error"}`. The message is the concise client error (e.g. `attempt to call a nil value`). The full stack is available in the runtime console log.
* **503** — Runtime API not enabled: `{"error": "Runtime API is not enabled"}`. This also holds when it is switched off for the running server (by an administrator or `SB_RUNTIME_API=0`), Chrome is missing, or the runtime pool failed to start. A headless browser that is not ready yet answers `{"error": "...", "code": "bridge_unavailable"}`; retry shortly.
* **504** — Timeout exceeded: `{"error": "...", "code": "timeout"}`.

# How it works
As documented in [[Architecture]], the vast majority of SilverBullet’s power is implemented in the client. However, there are use cases for programmatically accessing your space with all of SilverBullet (client’s) power.

When the Runtime API is enabled, the first request to an `/.runtime/` endpoint starts a separate headless Chrome process for that user and space. Each runtime has its own profile, cookies, browser storage, and console log. It loads the full SilverBullet client with the originating user’s identity and permissions. Removing Write or runtime access, disabling the account, or switching runtime off stops the affected browser and invalidates its credentials.

Once ready, the server communicates with the browser directly via Chrome DevTools Protocol (CDP). Because Lua code runs inside a real SilverBullet client, it has access to the full API surface — `editor.*`, `space.*`, queries, and everything else available to in-page scripts and widgets. The results reflect live client state.

## Idle stop
A runtime that has received no requests for 30 minutes is stopped: its Chrome exits and it uses no memory or CPU. The next request starts it again on the same profile, so the client picks up where it left off instead of rebuilding its index. That takes about a second, plus the time to index pages that changed in the meantime.

While a runtime is stopped, nothing runs in its client, including Space Lua event listeners such as `cron:secondPassed`.

To change the timeout, in minutes (`0` keeps runtimes running):
* In single-space mode, set `SB_RUNTIME_IDLE_TIMEOUT`, for example `SB_RUNTIME_IDLE_TIMEOUT=120`.
* In multi-space mode, use **Stop idle runtimes after** in the administrator's **APIs** tab, stored as `runtimeIdleTimeout` in `server.json`.

## Profiles
Each user of a space has one Chrome profile, holding the client's index and browser storage. It is kept when the runtime stops (whether idle, by an administrator's **Stop**, or at server shutdown) and reused next time.

A profile is deleted on **Reset**, when the user loses Write or runtime access or their credentials change, when the Runtime API is switched off, and when the space is deleted.

Profiles live under `.chrome-data` in the server's data folder, or under `SB_CHROME_DATA_DIR` when set. Their directory names are hashes of the server folder, space and user.

## Debugging
Set `SB_CHROME_SHOW=1` to run Chrome with a visible window — useful for watching what the headless client is doing. Set `SB_CHROME_DATA_DIR` to choose the directory that holds the runtime profiles. Startup logs report the detected Chrome executable or that Chrome is unavailable.

## Resource usage
Headless Chrome spawns several processes (browser, network, storage, and renderer) for each active user and space pair. Additional runtimes therefore cost a whole browser, not just a tab. Browsers start lazily so unused runtime permissions consume no Chrome processes, and stop again after a period without requests (see [[#Idle stop]]).

## Managing runtimes
Server administrators can open **Admin → APIs** to see each instantiated runtime's space, user, status, CPU, estimated memory, and profile disk usage. The list refreshes while visible and includes stopped runtimes with retained profiles. Viewing it does not start Chrome.
