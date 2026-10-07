---
tags: maturity/experimental
references:
- bin/sb/src/cli.rs
- bin/sb/src/commands/mod.rs
- bin/sb/src/main.rs
---

> **note** This is **not** the server
> `sb` is the optional **CLI client**, it talks to an already-running SilverBullet instance over HTTP. If you’re looking for the actual server binary, that’s [[Install/Server Binary]] (`silverbullet`), not this. You do not need `sb` to use SilverBullet.

The SilverBullet CLI is a companion command-line tool for interacting with a running SilverBullet instance from your terminal. It communicates with the server over HTTP. File commands use the [[HTTP API]] directly; Lua expressions, scripts, and logs use the [[Runtime API]].

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

# Discovering commands

Use `sb -h` for a compact command list and `sb --help` for a command guide and starting examples. Every command accepts `--help` without contacting a server; for example, `sb fs edit --help` includes the batch JSON format and revision rules. Connection and output flags are grouped separately from command options. Flags can appear before or after the command.

`sb --help` also lists the calls for [[#Exploring your space|exploring your space]]: its tags, Lua API, and commands.

Output selectors are mutually exclusive: choose `--json`, `--text`, or `-o <format>`. Unknown format names are rejected before connecting. `eval`, `script`, and `query` accept `auto`, `text`, `table`, `json`, `jsonl`, and `yaml`; file commands accept `auto`, `text`, `json`, and `jsonl`. Auto selects text on a terminal and JSON when piped, except `fs read`, which emits exact bytes by default. Logs, connection management, version, and upgrade commands print their own text output.

# Commands
Runtime commands may take a few seconds on first use while the [[Runtime API]] starts its headless client. `sb fs` commands work without the Runtime API or Chromium.

## `fs`: remote files

List, read, create, edit, and delete files in a remote space using its existing HTTP filesystem API. Select a connection with the usual `--space`, `--url`, and `--token` flags. Paths are space-relative filenames, including `.md`; quote paths containing spaces and use `/` between directories. Content search, patch input, recursive deletion, copy, and move are not supported.

| Command | Behavior |
|---|---|
| `sb fs ls [path]` | Immediate children; `list` is an alias. Use `--recursive`, repeatable `--glob`, and optional `--limit`. |
| `sb fs read <path>` | Exact bytes on stdout, including binary attachments when redirected. |
| `sb fs stat <path>` | File metadata and revision. |
| `sb fs write <path>` | Write stdin or `--file <local-path>`; requires an explicit write policy. |
| `sb fs edit <path>` | Exact text replacement; supports JSON batches, `--all`, and `--dry-run`. |
| `sb fs rm <path>` | Delete one file; `delete` is an alias. |

```bash
sb fs ls Projects --recursive --glob '*.md' --glob '!Projects/Archive/**'
sb fs read 'Projects/Launch.md' --lines 10:30 --number
sb fs read 'Projects/Launch.md' > launch.md
sb fs write 'Projects/Idea.md' --create --file draft.md
sb fs edit 'Projects/Idea.md' --old 'Status: draft' --new 'Status: ready'
sb fs rm 'Projects/Idea.md'
```

`--glob` patterns without `/` match basenames at any depth; patterns containing `/` match full space-relative paths. Positive patterns are ORed; `!` patterns exclude matches. `*` does not cross directories; `**` does. Globs and sorting are case-sensitive. The full inventory is downloaded before filtering. A limit that cuts off entries is reported explicitly and exits with code 7; an empty listing succeeds.

### Writing and revisions

Choose exactly one policy for `write`: `--create` creates only when absent, `--if-match <revision>` replaces the revision you inspected, and `--overwrite` explicitly allows unconditional creation or replacement. `--file -` reads stdin, as does an omitted `--file` when stdin is redirected. No input prompt is opened automatically.

`read --json` and `stat --json` include the opaque, quoted `revision` returned by the server. Preserve that string unchanged when passing it to `--if-match`. `edit` always uses a conditional write against its own initial read. Supplying `--if-match` additionally checks that the file still matches your earlier inspection. `rm --if-match` conditionally deletes; plain `rm` is unconditional. Conflicts fail without retry or automatic merging. A lost connection during a mutation can leave its outcome uncertain: inspect the remote file before retrying.

### Batch edits

```bash
sb fs edit 'Projects/Launch.md' --file - <<'JSON'
{
  "edits": [
    {"old": "Status: draft", "new": "Status: ready"},
    {"old": "- [ ] Review copy", "new": "- [x] Review copy"}
  ]
}
JSON
```

Each `old` must match exactly once in the original file, including whitespace and line endings. All batch ranges must be disjoint. Validation completes before one conditional write; a late failure leaves the whole file untouched. Empty `new` deletes a block; empty `old` is invalid. For a single `--old`/`--new` edit, `--all` replaces every non-overlapping occurrence. `--dry-run` shows a unified diff without writing. Unchanged bytes, including CRLF and BOMs, are preserved. Editing requires UTF-8 without NUL and limits both original and resulting files to 8 MiB.

### Output and limits

`read` defaults to exact bytes even when piped, with no added newline. `--lines START:END` selects a one-based inclusive range; `--number` adds original line numbers and cannot be combined with JSON. A range still downloads the entire file. Other commands default to text on a terminal and JSON when redirected. Explicit `--text`, `--json`/`-o json`, and `-o jsonl` select output; other modes and conflicting selectors are rejected for `fs`. JSON reads contain UTF-8 content and full-file metadata/revision. Binary content requires raw redirected output. JSONL listings emit entry records followed by a summary record; other commands emit one JSON record.

Reads and writes have a default CLI transfer cap of 16 MiB. `--max-bytes N` changes it; `--max-bytes 0` removes the CLI cap, while server request limits still apply. Oversized reads fail without emitting partial content. File operations use server-stored bytes, not unsaved editor buffers, and do not decrypt client-encrypted spaces.

Errors go to stderr as text or a JSON `error` object with a stable `code` and `message`, plus path/revision details when available. Exit codes are 0 for success, 2 for invalid arguments or edit input, 3 for a missing target, 4 for authentication/access denial, 5 for revision conflict or an existing create-only target, 6 for edit mismatch/ambiguity/overlap, 7 for a truncated listing, and 8 for operational failures. Code 1 is unassigned for `fs`.

## `eval <expression>`
Evaluate a single Lua expression and print the result. `lua` remains a compatibility alias.

```bash
sb eval "1 + 1"
# => 2

sb eval "editor.getCurrentPage()"
# => "index"

sb eval 'system.reboot()'   # pick up edited Space Lua, styles and config
sb eval 'space.lint("Page")'   # problems on a page; space.lint() checks every page outside Library/
```

To check a page without opening it in the editor, call [[API/space#space.lint]]: it runs the editor's linters (frontmatter and data block YAML, `space-lua` syntax, objects checked against tag schemas, anchors) and renders every `${…}` directive and Lua code widget, returning a list of `{page, line, column, severity, message, source}` for the ones that fail. An empty list means no problems. Widgets render with the Space Lua currently loaded, so after editing `space-lua` blocks run `sb eval 'system.reboot()'` first.

## `script [code]`
Execute Lua from inline code, `--file`, or stdin when neither is supplied. Inline code and `--file` are mutually exclusive. The older `lua-script [file]` form remains available for compatibility.

```bash
sb script --file myscript.lua

# Or pipe from stdin:
echo 'local x = 40; return x + 2' | sb script
```

## `query <expression>`

Run a SLIQ query with `sb query 'from tags.page select name' --json`. See [[#Exploring your space]] for listing the space's tags and reading the query syntax reference. Requires the Runtime API.

Quote the query in single quotes and use double quotes inside it. If the query itself contains a single quote, pass it through a quoted heredoc:

```bash
sb query "$(cat <<'EOF'
from p = index.pages() where p.name == "Bob's Notes" select p.name
EOF
)"
```

Query errors carry hints where the cause is a common mistake. Using `=` where `==` was meant (such as `where p.name = "x"`) gives `hint: use == to compare`. Calling an undefined name inside a query, such as a function that exists nowhere or a misspelled row variable, names it and says what the query binds instead. Errors about nil values name the global, local, field or method involved, and common habits from other languages get a suggestion: a missing string method such as `contains`, `{name: value}` in a table constructor, and SQL operators such as `like`, `in` and `is null`.

## Results
`eval`, `script`, and `query` return plain JSON (or the other `-o` formats rendered from it). A missing value, such as a query column absent on some rows, is `null` and the key stays: `{"name":"Books/Beta","rating":null}`. A query collection such as `index.pages("book")` returns its rows as an array, capped at 1000 rows; a longer one ends with a `"<truncated: N more rows; use sb query with where/limit>"` entry, so filter it with `sb query` instead. Values with no JSON form appear as string markers such as `"<function>"`. See [[Runtime API#Results]] for the full mapping.

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
Save a PNG of the runtime client to `file` (default `screenshot.png`), or write it to stdout with `-`. With `--json`, prints the path and image dimensions. Requires the Runtime API. Navigate first, then wait with [[API/editor#editor.awaitRender]] until widgets, `${…}` expressions and queries have finished rendering.

```bash
sb eval 'editor.navigate("Projects")'
sb eval 'editor.awaitRender()'
sb screenshot projects.png
sb screenshot projects-full.png --full-page
sb screenshot widget.png --selector '#sb-main .sb-page-slot-page-top'
```

| Flag | Description |
|---|---|
| `--selector <css>` | Capture the first matching element instead of the viewport |
| `--full-page` | Capture the whole page, not just the first screen. Cannot be combined with `--selector` |

A plain screenshot only shows what fits in the window (800×600 for the headless client). `--full-page` scrolls the editor from the top one screen at a time, waits for the lines, widgets and queries scrolled into view to render, and stitches the screens into one PNG with the top bar once at the top. Afterwards the editor is scrolled back to where it was. Pages taller than about 12000 pixels are cut off there, and `sb` prints a note on stderr.

On SilverBullet Desktop this captures the space's visible editor window.

## `version`
Print the installed CLI version.

## `upgrade` / `upgrade-edge`
Self-update the CLI binary to the latest stable or edge release.

# Exploring your space
These calls inspect the connected space itself, so results reflect its own tags, Space Lua functions, and commands, including those added by its libraries. `sb --help` lists the same calls.

Tags and their fields:
```bash
sb query 'from t = index.tags() select t.name'
sb eval 'index.tagSchema("page")'
```

Lua API:
```bash
sb eval 'table.keys(_G)'                                 # global names, namespaces included
sb eval 'spacelua.listFunctions()'                       # documented global functions
sb eval 'spacelua.listFunctions("editor")'               # functions in a namespace
sb eval 'spacelua.describe("editor.getText")'            # one function's signature and docs
sb eval 'spacelua.renderApiDocumentation("index")' --text  # Markdown, printed as is
sb eval 'system.reboot()'                                # pick up edited Space Lua, styles and config
```

Checking pages:
```bash
sb eval 'space.lint("Page")'                             # problems on a page (YAML, Lua, failing widgets); space.lint() for all
```

Commands:
```bash
sb eval 'system.listCommands()'
```

Query syntax:
```bash
sb fs read 'Library/Std/Docs/SLIQ Reference.md'
```

# Authentication
The CLI supports three authentication methods, configured per-space during `space add`:

* **Token** — sends an `Authorization: Bearer <token>` header. Use this with `SB_AUTH_TOKEN` on a [[Dashboard#Single-space mode|single-space]] server, or with a per-account [[Dashboard#API tokens|API token]] on an accounts-based server.
* **Password** — authenticates via `POST /.auth` (username/password), then uses the returned session cookie. Use this with `SB_USER` on a single-space server, or with an account username/password on a space you’re a member of.
* **None** — no authentication (for local or trusted-network setups, or public spaces).

Credentials are encrypted at rest using AES-256-GCM with PBKDF2 key derivation.

# Examples

Query your space for recent pages:
```bash
sb eval 'query[[from tags.page order by lastModified desc limit 5 select name]]'
```

Run a script that lists all tasks:
```bash
echo 'return query[[from tags.task where not done select ref, name]]' | sb script
```

Tail logs while debugging:
```bash
sb logs -f
```
