---
description: "Search the full text of a space."
tags: glossary maturity/beta
references:
- libraries/Library/Std/APIs/Search.md
- server-search/src/fulltext/mod.rs
- server-search/src/limits.rs
---
Search searches the text of every page in your space. Open it from the command palette or press `Ctrl-Shift-f` (`Cmd-Shift-f` on macOS). Each result shows the page name and an excerpt with the matching words highlighted.

Reopening search brings back your last query and its results in that browser tab, selected so you can type over it; with text selected on a single line in the editor, that text becomes the query instead.

# Segments
Like the [[Page Picker]], search has three segments:
* **Pages** searches regular pages.
* **Meta** searches [[Meta Page|meta pages]].
* **All** searches every page.

Pages and Meta need the index to finish building once; until then they show a notice, and **All** works right away.

# Modes
The dropdown next to the input chooses how your query is matched:
* **All words** finds pages that contain every word you typed, in any order, in the page or its name. Words match their other forms in English, Dutch, German, Spanish and French, so `bikes` also finds `bike`, and `Tomate` finds `Tomaten`. When no page contains all the words, search shows similar pages instead: pages that contain some of the words, or the words with a typo (`rollbakc` finds `rollback`).
* **Exact phrase** finds the words exactly as typed, next to each other.

Queries need at least 2 characters.

# What is searched
Search covers the Markdown pages in your space, up to 1 MiB each. Built-in library pages bundled with SilverBullet and attachments are not searched. It searches the saved pages, so unsaved edits are not included, and the cursor can land slightly off when the open page has unsaved changes above the match.

# The search index
The server keeps a full-text index of the space and updates it as pages change, usually within a second. After the server starts, it builds or catches up the index in the background; until that finishes, results come with a "Search index building" notice and may be incomplete.

Where the index lives:
* On a server with several spaces, under `search/indexes/` in the server's data folder, so restarts reuse it.
* On a single-space server, in memory, rebuilt at every start.
* In SilverBullet Desktop, in the app's data folder.

On a server started with `SB_FS_WATCH=off`, edits made through SilverBullet still update the index right away, while changes made to the files by other programs are picked up within 10 minutes.

# Space Lua and the command line
The same search is available from [[Space Lua]] as `search.status()` and `search.find()`. See [[API/search]].

From the command line, run it with `sb eval` (see [[CLI]]):

```bash
sb eval 'search.find("garden plan")'
sb eval 'search.find("flat tire", {mode = "phrase", limit = 10})'
```

The result is JSON with `items` (each with `page`, `line`, `excerpt` and more) and `total`.
