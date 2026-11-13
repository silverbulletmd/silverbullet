---
tags: maturity/beta
references:
- bin/sb/src/cli.rs
- bin/sb/src/commands/mod.rs
- bin/sb/src/main.rs
---
The SilverBullet CLI is a companion command-line tool for interacting with a running SilverBullet instance from your terminal. It communicates with the server over HTTP. File commands use the [[HTTP API]] directly. Lua, queries, screenshots and logs use the [[Runtime API]]. `sb help` gives an AI assistant or a person the space’s skills and a map of the space (see [[#`help [topic]`]]).

> **note** This is **not** the server
> `sb` is the optional **CLI client**, it talks to an already-running SilverBullet instance over HTTP. If you’re looking for the actual server binary, that’s [[Install/Server Binary]] (`silverbullet`), not this. You do not need `sb` to use SilverBullet.


# Installation
On macOS, Linux and FreeBSD:
```bash
curl -fsSL https://silverbullet.md/install-sb.sh | sh
```
This installs `sb` to `~/.local/bin` (set `SB_INSTALL_DIR` to change that). Add `-s -- --edge` after `sh` for the edge build, or `-s -- --version <version>` for a specific release.

On Windows (PowerShell):
```powershell
irm https://silverbullet.md/install-sb.ps1 | iex
```
This installs `sb.exe` to `%LOCALAPPDATA%\SilverBullet\bin` and adds that folder to your user `Path`. Set `$env:SB_CHANNEL = "edge"` or `$env:SB_VERSION` first to choose another build.

The binaries are also available on the [GitHub releases page](https://github.com/silverbulletmd/silverbullet/releases) (or the [edge](https://github.com/silverbulletmd/silverbullet/releases/tag/edge) build).

Once installed, it can self-update:
```bash
sb upgrade       # latest stable release
sb upgrade-edge  # latest edge (main branch) build
```

# Configuring spaces
Before using the CLI, connect it to a SilverBullet instance. The CLI stores space configurations in `config.json` in:

* macOS and Linux: `~/.config/silverbullet` (respects `XDG_CONFIG_HOME`)
* Windows: `%APPDATA%\SilverBullet` (a configuration in the previous location, `%USERPROFILE%\.config\silverbullet`, is copied there on first use)
* Anywhere: the directory in `SB_CONFIG_DIR`, when set

[[Install/Desktop|SilverBullet Desktop]] uses the same list, so spaces added in either one show up in both. The directory also holds the `key` that encrypts saved tokens and passwords: do not commit it to a dotfiles repository or sync it between machines.

## Adding a space
```bash
sb space add
```
This interactive wizard will prompt for:
1. A **name** for the space (alphanumeric and hyphens)
2. The **URL** of your SilverBullet server
3. **Authentication** method ([[Install/Configuration#Authentication|token]], username/password, or none)

The name defaults to the URL’s last path segment, or else the first part of its host: both `https://sb.example.com/notes` and `https://notes.example.com` become `notes`. To skip the prompts, pass the URL and flags:
```bash
sb space add https://notes.example.com --name work --auth browser --no-browser
echo "$TOKEN" | sb space add https://notes.example.com --auth token
sb space add https://notes.example.com --auth password --username alice < password.txt
```
When stdin is not a terminal (scripts, agents), `sb space add` never prompts. It uses the default name, and browser sign-in when the server requires authentication, unless `--name` or `--auth` say otherwise. A token or password is read as a single line from stdin. Failed authentication exits with an error instead of retrying.

## Folder spaces (SilverBullet Desktop)
With [[Install/Desktop|SilverBullet Desktop]] installed, `sb` also works with local folders:
```bash
sb space create ~/Notes/harbor   # new space in a missing or empty folder
sb space add ./notes             # register a folder that already holds a space
sb .                             # open the current folder in SilverBullet Desktop
sb open ./notes                  # the same, for a given file or folder
```
New spaces start with the shell off and managed revisions, like spaces created in SilverBullet Desktop. The name defaults to the folder name. Pass `--name` to choose one. Names are trimmed, cannot be empty or contain control characters, and must be unique. `sb space add` needs an existing folder. Use `sb space create` for a new one. Space commands print JSON when their output is piped or with `--json`, and text on a terminal or with `--text`.

Inside a registered folder, commands pick that space automatically (the most specific folder wins), so `--space` is optional. Commands that need the space (`fs`, `help`, `search`, `related`) or its runtime (`lua`, `query`, `logs`, `screenshot`, and `fs read --rendered`) start SilverBullet Desktop's server for it in the background when it is not running yet, without opening an editor window, and wait for it, up to `--timeout`. A stopped folder space can therefore make even `sb fs ls` take a few seconds the first time.

Folder spaces are served by SilverBullet Desktop. Without it installed, file commands (`fs`), runtime commands, and creating, adding, renaming, moving or relocating a folder space all fail with an error saying Desktop is required. `sb space list` and `sb space remove` still work, so entries left by an uninstalled Desktop can be cleaned up. Remote spaces don’t need Desktop.

## Managing spaces
```bash
sb space list [--all] [--json]    # alias ls; JSON: id, name, folderPath or url, auth, runningPort, syncEnabled, hidden
sb space rename <name> <new-name>
sb space mv <name> <new-folder> [--dry-run]     # alias move: move a folder space and its files (same disk only)
sb space relocate <name> <folder> [--force] [--dry-run]   # alias set-path: the folder was already moved
sb space remove <name>            # alias rm
```
Single-file spaces opened in Desktop are hidden from the list. Add `--all` to show them. A folder space cannot be moved or removed while SilverBullet Desktop has it open. `mv` renames the folder, so the new folder must not exist and must be on the same disk. For another disk, copy the folder yourself and run `relocate`. `relocate` only updates the saved path and needs `--force` while the old folder still exists. Use it for the same folder moved intact. For a space that syncs, after restoring from a backup or older copy, turn sync off and on again in SilverBullet Desktop so the first sync compares both sides. Both refuse targets that overlap another space, and `--dry-run` reports what would change without changing anything. A space that syncs with a remote can be moved once SilverBullet Desktop has been updated to a version that stores sync state by space id. Removing a space never deletes its files.

# Global flags
These flags are available on all commands that connect to a space:

* `-s, --space <name>`: Select a space by name or id (auto-selected if only one is configured, or when the current folder is a registered space). An exact name wins, then an exact id, then a name in any case when only one space has it. A name that fits two spaces is refused and both ids are listed
* `--url <url>`: Connect directly to a URL (bypasses space config)
* `--token <token>`: Authentication token (use with `--url`)
* `-t, --timeout <seconds>`: Request timeout (default: 30)

# Discovering commands
Start with `sb help`: it lists your saved spaces, the skills and an outline of the selected space, and `sb help <topic>` prints a skill (see [[#`help [topic]`]]). Use `sb -h` for a compact command list and `sb --help` for a command guide and starting examples. Every command accepts `--help` without contacting a server. For example, `sb fs edit --help` includes the batch JSON format and revision rules. Connection and output flags are grouped separately from command options. Flags can appear before or after the command.

`sb --help` also lists the calls for [[#Exploring your space|exploring your space]]: its tags, Lua API, and commands.

Output selectors are mutually exclusive: choose `--json`, `--text`, or `-o <format>`. Unknown format names are rejected before connecting. `lua` and `query` accept `auto`, `text`, `table`, `json`, `jsonl`, and `yaml`. File commands accept `auto`, `text`, `json`, and `jsonl`. Auto selects text on a terminal and JSON when piped, except `fs read`, which emits exact bytes by default. Logs, connection management, version, and upgrade commands print their own text output.

# Commands
Runtime commands may take a few seconds on first use while the [[Runtime API]] starts its headless client. `sb help`, `sb fs` (except `fs read --rendered`, and the script reload after a write), `sb search` and `sb related` work without the Runtime API or Chromium.

## `help [topic]`
The first call for an AI assistant. Without a topic it lists your saved spaces, which space is selected, the skills available there and an outline of its folders, pages and frontmatter data. A skill is a page tagged `meta/skill`; the seven built-in ones (the `Library/Std` pages on Space Lua, queries, tags, widgets, Markdown, templates and mentions) are embedded in `sb`, so they are listed even when no space is configured. When the selected space is reachable, its own copy of a skill wins over the embedded one, and its own and its libraries’ skills are listed too. The space’s server answers `GET /.help` ([[HTTP API#Help]]). If it cannot be read, because the server is older than `sb`, cannot be reached or only lists skills for signed-in users, `sb help` lists the embedded skills with a note and still exits 0.

With a topic, `sb help` prints that page. Topic words are joined, so `sb help Space Lua` needs no quotes. A topic is looked up in this order: a skill by its full page name, then the space’s page of that name (any page, not just skills), then a skill by short name (the last part of its name; the space’s own wins over a library’s, which wins over the built-in one), then a skill whose name contains the topic. A topic that matches nothing lists close names. A topic that names a command, such as `sb help fs`, points to `sb <command> --help`, because `sb help` is not flag help. `--json` prints the data instead of text: the spaces, the selected one and the help data for the overview, and `page`, `source` and `text` for a topic.

```bash
sb help
sb --space notes help
sb help Querying
sb help Space Lua
```

## `fs`: remote files
List, read, create, edit, and delete files in a remote space using its existing HTTP filesystem API. Select a connection with the usual `--space`, `--url`, and `--token` flags. Paths are space-relative filenames, including `.md`. Quote paths containing spaces and use `/` between directories. Patch input, recursive deletion, copy, and move are not supported. To search page content, use [[#`search <text>`|`sb search`]].

* `sb fs ls [path]`: List immediate children. `list` is an alias. Use `--recursive`, repeatable `--glob`, and optional `--limit`.
* `sb fs read <path>...`: Exact bytes on stdout, including binary attachments when redirected. Take up to 20 paths, a line window, an outline or the rendered page; see [[#Reading pages]].
* `sb fs stat <path>`: File metadata and revision.
* `sb fs write <path>`: Write stdin or `--file <local-path>` with an explicit write policy.
* `sb fs edit <path>`: Replace exact text, with JSON batches, `--all`, and `--dry-run` support.
* `sb fs rm <path>`: Delete one file. `delete` is an alias.

```bash
sb fs ls Projects --recursive --glob '*.md' --glob '!Projects/Archive/**'
sb fs read 'Projects/Launch.md' --lines 10:30 --number
sb fs read 'Projects/Launch.md' > launch.md
sb fs read 'Projects/Launch.md' --outline
sb fs read 'Projects/Launch.md' --offset 40 --limit 30
sb fs read 'Projects/Launch.md' --rendered
sb fs read 'Projects/Launch.md' 'Projects/Idea.md' --json
sb fs write 'Projects/Idea.md' --create --file draft.md
sb fs edit 'Projects/Idea.md' --old 'Status: draft' --new 'Status: ready'
sb fs rm 'Projects/Idea.md'
```

`--glob` patterns without `/` match basenames at any depth. Patterns containing `/` match full space-relative paths. Positive patterns are ORed. `!` patterns exclude matches. `*` does not cross directories. `**` does. Globs and sorting are case-sensitive. The full inventory is downloaded before filtering. A limit that cuts off entries is reported explicitly and exits with code 7. An empty listing succeeds.

### Writing and revisions
Filesystem responses carry the content revision in `X-SilverBullet-Revision`, which remains usable when a reverse proxy weakens or replaces `ETag`. The CLI falls back to strong ETags from older servers. A weak ETag alone allows reads but produces a null revision. Conditional edits require a usable revision.

Choose exactly one policy for `write`: `--create` creates only when absent, `--revision <revision>` (alias `--if-match`) replaces the revision you inspected, and `--overwrite` explicitly allows unconditional creation or replacement. `--file -` reads stdin, as does an omitted `--file` when stdin is redirected. No input prompt is opened automatically.

`read --json` and `stat --json` include the opaque, quoted `revision` returned by the server. Preserve that string unchanged when passing it to `--revision` (or `--if-match`). `edit` always uses a conditional write against its own initial read. Supplying `--revision` additionally checks that the file still matches your earlier inspection. `rm --revision` conditionally deletes. Plain `rm` is unconditional. Text output of `write` and `edit` ends with the new revision, ready for the next conditional call. Conflicts fail without retry or automatic merging, and say what the current revision is and how to read the file again. A lost connection during a mutation can leave its outcome uncertain: inspect the remote file before retrying.

### Space Lua and Space Style pages
A `write` or `edit` of a Markdown page that has, or had, `space-lua` or `space-style` blocks makes the space reload its scripts and styles, so the change takes effect at once, then reports that page’s load errors and lint problems (the same check as [[API/space#space.lint]]) on stderr. With `--json` they are in the result’s `reload` field: `status` (`clean`, `problems`, `failed` or `no_runtime`), `loadErrors` and `lint`. A write that reports problems still happened: stderr says so, and the command exits with code 9 so a script notices. Fix the page and write it again. The reload is skipped, and the exit code stays 0, with `--no-reload`, with `edit --dry-run`, when the space has no runtime (the Runtime API is off, or Desktop’s space is not running), or when the reload itself failed. The same happens for pages written through the [[MCP]]. After changing files any other way, such as in an editor outside SilverBullet or by git, reload by hand with `sb lua 'system.reboot()'`.

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

Each `old` must match exactly once in the original file, including whitespace. In a file with CRLF line endings, a line break (`\n`) in `old` or `new` stands for CRLF, so edits written with LF match and the file keeps its endings. All batch ranges must be disjoint. Validation completes before one conditional write. A late failure leaves the whole file untouched. Empty `new` deletes a block. Empty `old` is invalid. For a single `--old`/`--new` edit, `--all` replaces every non-overlapping occurrence. `--dry-run` shows a unified diff without writing. Unchanged bytes, including CRLF and BOMs, are preserved. Editing requires UTF-8 without NUL and limits both original and resulting files to 8 MiB.

### Reading pages
Beyond exact bytes, `read` can show a page the way an assistant needs it:

* `--offset N --limit M`: lines from line N (one-based), numbered like the MCP’s `read` tool. They replace `--lines`.
* `--outline`: the headings, code blocks and Lua functions of the page with their line numbers. Use it before reading a long page.
* `--rendered`: the page as it displays, with `${…}` directives and queries evaluated and widgets reduced to their text, followed by its lint problems. Needs a `.md` page and the Runtime API; the index is caught up with recent file changes first. `--offset` and `--limit` then apply to the rendered lines.
* Several paths (up to 20) print one section each, headed `=== <path> (revision <rev>) ===`. A path that fails is reported in its section and does not stop the others, and the exit code is the first failure’s. With `--json` the result is one document, `{"files": […]}`. Several paths cannot be combined with the options above or with `--lines` and `--number`.

### Output and limits
`read` defaults to exact bytes even when piped, with no added newline. `--lines START:END` selects a one-based inclusive range. `--number` adds original line numbers and cannot be combined with JSON. A range still downloads the entire file. Other commands default to text on a terminal and JSON when redirected. Explicit `--text`, `--json`/`-o json`, and `-o jsonl` select output. Other modes and conflicting selectors are rejected for `fs`. JSON reads contain UTF-8 content and full-file metadata/revision. Binary content requires raw redirected output. JSONL listings emit entry records followed by a summary record. Other commands emit one JSON record.

Reads and writes have a default CLI transfer cap of 16 MiB. `--max-bytes N` changes it. `--max-bytes 0` removes the CLI cap, while server request limits still apply. Oversized reads fail without emitting partial content. File operations use server-stored bytes, not unsaved editor buffers, and do not decrypt client-encrypted spaces.

Errors go to stderr as text or a JSON `error` object with a stable `code` and `message`, plus path/revision details when available. Exit codes are 0 for success, 2 for invalid arguments or edit input, 3 for a missing target, 4 for authentication/access denial, 5 for revision conflict or an existing create-only target, 6 for edit mismatch/ambiguity/overlap, 7 for a truncated listing, 8 for operational failures, and 9 for a write or edit that succeeded but whose Space Lua or Space Style has problems (see [[#Space Lua and Space Style pages]]). With code 9 the file is already changed: in JSON mode stdout holds the normal result with `written: true` and the `reload` details, and stderr an `error` with code `script_problems`. Code 1 is unassigned for `fs`.

## `lua [code]`
Run [[Space Lua]] in the space and print the result. `eval` and `script` are aliases, so older commands keep working. Give inline code, `--file <local-file>`, or nothing to read stdin. Inline code and `--file` are mutually exclusive.

Code that starts with a statement keyword (`return`, `local`, `for`, `if`, `while`, `repeat`, `function`, `do`, `goto`, `break`) runs as a script, and you `return` a value to print it. Anything else is evaluated as an expression first, and runs as a script only when it does not parse as an expression. Code never runs twice: when it runs and fails, that error is reported as is, and when it parses as neither, both errors are shown.

Before running, the space catches its index up with recent file changes, so a query sees pages written a moment ago. When that could not be confirmed, a note on stderr says so, for example when the catch-up took longer than 5 seconds. Console output logged during the call (`print`, `console.log`) goes to stderr as well, so stdout holds only the result, also with `--json`.

```bash
sb lua "1 + 1"
# => 2

sb lua "editor.getCurrentPage()"
# => "index"

sb lua 'return 40 + 2'
sb lua --file myscript.lua

# Or pipe from stdin:
echo 'local x = 40; return x + 2' | sb lua

sb lua 'system.reboot()'       # after changing files outside sb (not needed after sb fs write/edit)
sb lua 'space.lint("Page")'    # problems on a page; space.lint() checks every page
```

To check a page without opening it in the editor, call [[API/space#space.lint]]: it runs the editor’s linters (frontmatter and data block YAML, `space-lua` syntax, objects checked against tag schemas, anchors) and renders every `${…}` directive and Lua code widget, returning a list of `{page, line, column, severity, message, source}` for the ones that fail. An empty list means no problems. A page written with `sb fs write` or `sb fs edit` (or through the [[MCP]]) has its scripts reloaded already, so `space.lint` sees them. Only after changing files by other means do you need `sb lua 'system.reboot()'` first.

## `query <expression>`
Run a SLIQ query with `sb query 'from p = index.pages() select p.name limit 10' --json`. See [[#Exploring your space]] for listing the space’s tags and reading the query syntax reference. Requires the Runtime API. Like `sb lua`, it first catches the index up with recent file changes.

Quote the query in single quotes and use double quotes inside it. If the query itself contains a single quote, pass it through a quoted heredoc:

```bash
sb query "$(cat <<'EOF'
from p = index.pages() where p.name == "Bob's Notes" select p.name
EOF
)"
```

Query errors carry hints where the cause is a common mistake. Using `=` where `==` was meant (such as `where p.name = "x"`) gives `hint: use == to compare`. Calling an undefined name inside a query, such as a function that exists nowhere or a misspelled row variable, names it and says what the query binds instead. Errors about nil values name the global, local, field or method involved, and common habits from other languages get a suggestion: a missing string method such as `contains`, `{name: value}` in a table constructor, and SQL operators such as `like`, `in` and `is null`.

## Results
`lua` and `query` return plain JSON (or the other `-o` formats rendered from it). A missing value, such as a query column absent on some rows, is `null` and the key stays: `{"name":"Books/Beta","rating":null}`. A query collection such as `index.pages("book")` returns its rows as an array, capped at 1000 rows. A longer one ends with a `"<truncated: N more rows; use sb query with where/limit>"` entry, so filter it with `sb query` instead. Values with no JSON form appear as string markers such as `"<function>"`. See [[Runtime API#Results]] for the full mapping.

## `search <text>`
Search the pages of the space (see [[Search]]) through the server’s [[HTTP API#Search|search API]], so no Lua runtime or headless browser is needed. Prints one line per page, `Page:line  excerpt`, best match first. With `--json`, it prints the server’s response (`items`, `total`, `partial`, `notice`). Notices, such as a semantic search falling back to word matching, and a truncated result go to stderr. Like `sb lua`, it first lets the search index catch up with recent file changes, so it finds a page written a moment ago. When that could not be confirmed within 5 seconds, or the space polls for file changes, a note on stderr says so.

```bash
sb search 'garden irrigation'
sb search 'garden irrigation' --mode phrase --limit 5 --json
sb search --status
```

* `--mode <words|phrase|semantic>`: How to match, like the modes of the search box: all words, exact phrase, or by meaning. Without it, the space’s default: semantic where the space has semantic search, words otherwise
* `-n, --limit <int>`: Maximum number of pages (the server caps it at 50)
* `--status`: Show the state of the search index and which modes the space offers, instead of searching. A flag, so `sb search status` searches for the word “status”

A public visitor’s connection only gets the modes the server allows visitors: no semantic search until its index is ready.

## `related <page>`
List the pages most similar in meaning to a page, in the same format as `search`. Pass the page name without `.md`. It needs semantic search, so it fails on a space without it (`sb search --status` shows whether the space has it), and it is not available to public visitors.

```bash
sb related 'Projects/Launch'
sb related Launch --limit 5 --json
```

## `logs`
Show console logs from the headless browser client.

```bash
sb logs              # last 100 entries
sb logs -n 20        # last 20 entries
sb logs -f           # follow (tail) mode
```

* `-n, --lines <int>`: Number of entries (default: 100)
* `-f, --follow`: Continuously stream new log entries

## `screenshot [file]`
Save a PNG of the runtime client to `file` (default `screenshot.png`), or write it to stdout with `-`. With `--json`, prints the path and image dimensions. Requires the Runtime API. Like `sb lua`, it first catches the index up with recent file changes. Give `--page` to open a page first, or navigate yourself and wait with [[API/editor#editor.awaitRender]] until widgets, `${…}` expressions and queries have finished rendering.

```bash
sb screenshot --page Projects
sb lua 'editor.navigate("Projects")'
sb lua 'editor.awaitRender()'
sb screenshot projects.png
sb screenshot projects-full.png --full-page
sb screenshot widget.png --selector '#sb-main .sb-page-slot-page-top'
```

* `--page <name>`: Open this page and wait until the editor shows it, then capture. It does not wait for slow widgets and queries: for those, navigate and call `editor.awaitRender()` with `sb lua` as above. If the editor does not show the page in time, a note on stderr says so and the screenshot is taken anyway
* `--selector <css>`: Capture the first matching element instead of the viewport
* `--full-page`: Capture the whole page, not just the first screen. Cannot be combined with `--selector`

A plain screenshot only shows what fits in the window (800×600 for the headless client). `--full-page` scrolls the editor from the top one screen at a time, waits for the lines, widgets and queries scrolled into view to render, and stitches the screens into one PNG with the top bar once at the top. Afterwards the editor is scrolled back to where it was. Pages taller than about 12000 pixels are cut off there, and `sb` prints a note on stderr.

On SilverBullet Desktop this captures the space’s visible editor window.

## `version`
Print the installed CLI version.

## `upgrade` / `upgrade-edge`
Self-update the CLI binary to the latest stable or edge release.

# Exploring your space
These calls inspect the connected space itself, so results reflect its own tags, Space Lua functions, and commands, including those added by its libraries. `sb --help` lists the same calls.

Tags and their fields:
```bash
sb query 'from t = index.tags() select t.name'
sb lua 'index.tagSchema("page")'
```

Lua API:
```bash
sb lua 'table.keys(_G)'                                 # global names, namespaces included
sb lua 'spacelua.listFunctions()'                       # documented global functions
sb lua 'spacelua.listFunctions("editor")'               # functions in a namespace
sb lua 'spacelua.describe("editor.getText")'            # one function's signature and docs
sb lua 'spacelua.renderApiDocumentation("index")' --text  # Markdown, printed as is
sb lua 'system.reboot()'                                 # after changing files outside sb
```

Checking pages:
```bash
sb lua 'space.lint("Page")'                             # problems on a page (YAML, Lua, failing widgets); space.lint() for all
```

Commands:
```bash
sb lua 'system.listCommands()'
```

Query syntax:
```bash
sb fs read 'Library/Std/Docs/SLIQ Reference.md'
```

Skills (guides for Space Lua, queries, tags and more):
```bash
sb help
sb help Querying
```

# Authentication
The CLI supports three authentication methods, configured per-space during `space add`:

* **Token** — sends an `Authorization: Bearer <token>` header. Use this with `SB_AUTH_TOKEN` on a [[Install/Server Modes#Single-space mode|single-space]] server, or with a per-account [[Authentication#API|API token]] on an accounts-based server.
* **Password** — authenticates via `POST /.auth` (username/password), then uses the returned session cookie. Use this with `SB_USER` on a single-space server, or with an account username/password on a space you’re a member of.
* **None** — no authentication (for local or trusted-network setups, or public spaces).

Credentials are encrypted at rest using AES-256-GCM with PBKDF2 key derivation.

# Examples
Query your space for recent pages:
```bash
sb lua 'query[[from p = index.pages() order by p.lastModified desc limit 5 select p.name]]'
```

Run a script that lists all tasks:
```bash
echo 'return query[[from t = index.tasks() where not t.done select t.ref, t.name]]' | sb lua
```

Tail logs while debugging:
```bash
sb logs -f
```
