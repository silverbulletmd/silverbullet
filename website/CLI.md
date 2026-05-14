#maturity/experimental

The SilverBullet CLI is a companion command-line tool for interacting with a running SilverBullet instance from your terminal. It communicates with the server via the [[Runtime API]], letting you evaluate Lua expressions, run scripts, open an interactive REPL, tail logs, and more — without touching a browser.

# Installation
The CLI binary (`sb`) is available alongside the server binary on the [GitHub releases page](https://github.com/silverbulletmd/silverbullet/releases) (or the [edge](https://github.com/silverbulletmd/silverbullet/releases/tag/edge) build). Download the version matching your platform.

Once installed, it can self-update:
```bash
sb upgrade       # latest stable release
sb upgrade-edge  # latest edge (main branch) build
```

# Configuring spaces
Before using the CLI, connect it to a SilverBullet instance. The CLI stores space configurations in `~/.config/silverbullet/config.json` (respects `XDG_CONFIG_HOME`).

## Adding a space
```bash
sb space add
```
This interactive wizard will prompt for:
1. A **name** for the space (alphanumeric and hyphens)
2. The **URL** of your SilverBullet server
3. **Authentication** method ([[Install/Configuration#Authentication|token]], username/password, or none)

## Listing and removing spaces
```bash
sb space list
sb space remove <name>
```

# Global flags
These flags are available on all commands that connect to a space:

| Flag | Description |
|---|---|
| `-s, --space <name>` | Select a space by name (auto-selected if only one is configured) |
| `--url <url>` | Connect directly to a URL (bypasses space config) |
| `--token <token>` | Authentication token (use with `--url`) |
| `-t, --timeout <seconds>` | Request timeout (default: 30) |

# Commands
Note that the first call may take a few seconds, since the [[Runtime API]] will spin up a headless Chromium instance and need to perform an initial index for the first call.

## `lua <expression>`
Evaluate a single Lua expression and print the result.

```bash
sb lua "1 + 1"
# => 2

sb lua "editor.getCurrentPage()"
# => "index"
```

## `lua-script [file]`
Execute a multi-line Lua script from a file or stdin.

```bash
sb lua-script myscript.lua

# Or pipe from stdin:
echo 'local x = 40; return x + 2' | sb lua-script
```

## `repl`
Open an interactive Lua REPL with multi-line support.

```bash
sb repl
```

Special commands inside the REPL:
* `.exit` or `Ctrl-D` — exit
* `.script` / `.end` — enter/exit multi-line script mode
* `.timeout <seconds>` — change request timeout

The REPL automatically detects incomplete expressions (unclosed brackets, blocks) and waits for more input.

## `get [tag] [ref]`
List indexed tags, list objects of a tag, or fetch a single object — kubectl-style ergonomics on top of the [[Runtime API]]'s `/.runtime/objects/*` endpoints.

```bash
sb get                            # list all known tag names
sb get task                       # list all task objects
sb get meta/library               # list all libraries
sb get page "Daily/2026-05-14"    # fetch a single page by ref
```

Filtering, ordering, paging, and projection:

```bash
# Unfinished tasks, highest priority first, top 20
sb get task -l done=false --sort-by priority:desc --limit 20

# Tasks in any of several statuses
sb get task --where status:in=open,pending,blocked

# Pages starting with a prefix
sb get page --where name:startsWith=2026-

# Project only the fields you care about
sb get page --where meta.author=alice --select name,lastModified
```

Operators for `--where`: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `startsWith`. Use `field:OP=value` form, e.g. `--where due:lte=2026-06-01`. Multiple `--where` flags are AND-ed.

Values are auto-typed (`42` → number, `true`/`false` → boolean, `null` → nil, else string). Force a type with a prefix: `--where zipCode=str:01234`, `--where count:gt=num:10`, `--where active=bool:true`.

Output:

| Flag | Behavior |
|---|---|
| `-o auto` (default) | Table on a TTY or with `--text`; JSON otherwise |
| `-o table` | kubectl-style aligned columns. Up to 8 columns picked from common fields; cells truncated at 40 chars |
| `-o json` | Pretty-printed JSON array |
| `-o jsonl` | One JSON object per line (good for `xargs` / line-oriented pipes) |
| `-o yaml` | YAML |
| `-v, --verbose` | Adds the synthesized Lua query as `X-Equivalent-Lua` response header |

Exit codes: `0` success, `1` transport error, `2` API error (non-2xx other than 404), `3` not found (404 — only meaningful for the `sb get <tag> <ref>` form).

## `logs`
Show console logs from the headless browser client.

```bash
sb logs              # last 100 entries
sb logs -n 20        # last 20 entries
sb logs -f           # follow (tail) mode
```

| Flag | Description |
|---|---|
| `-n, --lines <int>` | Number of entries (default: 100) |
| `-f, --follow` | Continuously stream new log entries |

## `screenshot [file]`
Capture a PNG screenshot of the headless client viewport.

```bash
sb screenshot page.png  # save to file
sb screenshot > page.png  # or pipe to stdout
```

## `version`
Print the installed CLI version.

## `upgrade` / `upgrade-edge`
Self-update the CLI binary to the latest stable or edge release.

# Authentication
The CLI supports three authentication methods, configured per-space during `space add`:

* **Token** — sends an `Authorization: Bearer <token>` header. Use this with `SB_AUTH_TOKEN` on the server.
* **Password** — authenticates via `POST /.auth` (username/password), then uses the returned session cookie. Use this with `SB_USER` on the server.
* **None** — no authentication (for local or trusted-network setups).

Credentials are encrypted at rest using AES-256-GCM with PBKDF2 key derivation.

# Examples

Query your space for recent pages:
```bash
sb lua 'query[[from tags.page order by lastModified desc limit 5 select name]]'
```

Run a script that lists all tasks:
```bash
echo 'return query[[from tags.task where not done select ref, name]]' | sb lua-script
```

Tail logs while debugging:
```bash
sb logs -f
```
