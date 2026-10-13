---
description: "Search the full text of a space in various ways."
tags: glossary maturity/beta
references:
- libraries/Library/Std/APIs/Search.md
- server-search/src/ripgrep/limits.rs
- server-search/src/ripgrep/discover.rs
---
Search searches the text of every page in your space. Open it from the command palette or press `Ctrl-Shift-f` (`Cmd-Shift-f` on macOS). Each result shows the page name and an excerpt with the match highlighted.

# Segments
Like the [[Page Picker]], search has three segments:
* **Pages** searches regular pages.
* **Meta** searches [[Meta Page|meta pages]].
* **All** searches every page.

Pages and Meta need the index to finish building once; until then they show a notice, and **All** works right away.

# Modes
The dropdown next to the input chooses how your query is matched:
* **All words** finds pages where every word you typed appears somewhere in the page or its name, in any order and not necessarily on the same line.
* **Exact phrase** finds the words exactly as typed, next to each other.
* **Regex** treats the query as a regular expression. Matching is case-insensitive unless the query contains an uppercase letter (smart case).

Queries need at least 2 characters.

# What is searched
Search reads the saved Markdown pages on the server, so unsaved edits are not included, and the cursor can land slightly off when the open page has unsaved changes above the match. Built-in library pages bundled with SilverBullet and attachments are not searched.

# Setup
Search uses [ripgrep](https://github.com/BurntSushi/ripgrep) on the server. The Docker image includes it. Otherwise install it so that `rg` is on the server's `PATH`, or point `SB_RIPGREP_PATH` at the binary:
* macOS: `brew install ripgrep`
* Debian and Ubuntu: `apt install ripgrep`
* Windows: `winget install BurntSushi.ripgrep.MSVC`

Without ripgrep, the **Space: Search** command does not appear, and the server logs a warning at startup. When ripgrep is found, the startup log shows its path.

# Access
Anyone signed in who can read the space can search it. Visitors who aren't signed in, such as readers of a [[Publishing|published]] space or of a server started with `SB_READ_ONLY=1` and no authentication, get no search: the **Space: Search** command doesn't appear for them, because searching runs ripgrep over the whole space on every query.

Raw ripgrep access (`sb fs rg` in the [[CLI]] and `search.rg`) requires write access and is never available to visitors who aren't signed in. It never reads files the space hides: naming one is refused, and searches that would walk more than 1000 hidden files must be narrowed with paths.

# Limits
Every search runs with fixed limits so that one query can't slow down the server. They aren't configurable.
* A search stops after 3 seconds (15 seconds for raw ripgrep) and returns what it found so far.
* At most 3 searches run at once server-wide; others wait up to 1 second for a free slot, then ask you to try again.
* Queries need at least 2 characters, can be up to 4096 bytes and 16 words long, and return at most 50 pages.
* Files over 1 MiB are skipped, and one search produces at most 8 MiB of output.
* On Unix, ripgrep runs at lower priority with a 10-second CPU time limit.

# Space Lua
The same search is available from [[Space Lua]] as `search.status()`, `search.find()` and `search.related()`. See [[API/search]].
