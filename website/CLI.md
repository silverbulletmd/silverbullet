#maturity/experimental

The SilverBullet CLI is a companion command-line tool for interacting with a running SilverBullet instance from your terminal. It communicates with the server via the [[Runtime API]], letting you evaluate Lua expressions, run scripts, open an interactive REPL, tail logs, and more — without touching a browser.

# Installation
The CLI binary (`silverbullet-cli`) is available alongside the server binary on the [GitHub releases page](https://github.com/silverbulletmd/silverbullet/releases) (or the [edge](https://github.com/silverbulletmd/silverbullet/releases/tag/edge) build). Download the version matching your platform.

Once installed, it can self-update:
```bash
silverbullet-cli upgrade       # latest stable release
silverbullet-cli upgrade-edge  # latest edge (main branch) build
```

# Configuring spaces
Before using the CLI, connect it to a SilverBullet instance. The CLI stores space configurations in `~/.config/silverbullet/config.json` (respects `XDG_CONFIG_HOME`).

## Adding a space
```bash
silverbullet-cli space add
```
This interactive wizard will prompt for:
1. A **name** for the space (alphanumeric and hyphens)
2. The **URL** of your SilverBullet server
3. **Authentication** method ([[Install/Configuration#Authentication|token]], username/password, or none)

## Listing and removing spaces
```bash
silverbullet-cli space list
silverbullet-cli space remove <name>
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
silverbullet-cli lua "1 + 1"
# => 2

silverbullet-cli lua "editor.getCurrentPage()"
# => "index"
```

## `lua-script [file]`
Execute a multi-line Lua script from a file or stdin.

```bash
silverbullet-cli lua-script myscript.lua

# Or pipe from stdin:
echo 'local x = 40; return x + 2' | silverbullet-cli lua-script
```

## `repl`
Open an interactive Lua REPL with multi-line support.

```bash
silverbullet-cli repl
```

Special commands inside the REPL:
* `.exit` or `Ctrl-D` — exit
* `.script` / `.end` — enter/exit multi-line script mode
* `.timeout <seconds>` — change request timeout

The REPL automatically detects incomplete expressions (unclosed brackets, blocks) and waits for more input.

## `logs`
Show console logs from the headless browser client.

```bash
silverbullet-cli logs              # last 100 entries
silverbullet-cli logs -n 20        # last 20 entries
silverbullet-cli logs -f           # follow (tail) mode
```

| Flag | Description |
|---|---|
| `-n, --lines <int>` | Number of entries (default: 100) |
| `-f, --follow` | Continuously stream new log entries |

## `screenshot [file]`
Capture a PNG screenshot of the headless client viewport.

```bash
silverbullet-cli screenshot page.png  # save to file
silverbullet-cli screenshot > page.png  # or pipe to stdout
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
silverbullet-cli lua 'query[[from tags.page order by lastModified desc limit 5 select name]]'
```

Run a script that lists all tasks:
```bash
echo 'return query[[from tags.task where not done select ref, name]]' | silverbullet-cli lua-script
```

Tail logs while debugging:
```bash
silverbullet-cli logs -f
```
