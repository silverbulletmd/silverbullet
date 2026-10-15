---
description: "Search the full text of a space."
tags: glossary maturity/beta
references:
- libraries/Library/Std/APIs/Search.md
- server-search/src/fulltext/mod.rs
- server-search/src/semantic/mod.rs
- server-search/src/limits.rs
---
Search searches the text of every page in your space. Open it from the command palette or press `Ctrl-Shift-f` (`Cmd-Shift-f` on macOS). Each result shows the page name and an excerpt with the matching words highlighted.

Reopening search brings back your last query and its results in that browser tab, selected so you can type over it.

# Segments
Like the [[Page Picker]], search has three segments:
* **Pages** searches regular pages.
* **Meta** searches [[Meta Page|meta pages]].
* **All** searches every page.

# Modes
The dropdown next to the input chooses how your query is matched:
* **All words** finds pages that contain every word you typed, in any order, in the page or its name.
* **Exact phrase** finds the words exactly as typed, next to each other.
* **Semantic** (spaces with semantic search only) finds pages about what you typed, also in other words or another language. When no page contains all the words, the similar pages **All words** would show come after the meaning matches, or alone when nothing matches by meaning.

# Languages
**All words** and **Exact phrase** handle these languages fully:
* English, Dutch, German, Spanish and French: **All words** also finds a word's other forms (`bikes` finds `bike`).
* Arabic: **All words** also finds a word's other forms on pages written mostly in Arabic (`مكتبة` finds `المكتبة`), and both modes ignore how it is spelled: alef with or without hamza or madda, ة or ه, ى or ي, short vowel marks and tatweel.
* Chinese, Japanese and Korean: words are found inside text without spaces, so `東京` finds `東京タワー`.

In languages written in the Latin alphabet, a word typed without its accents also finds it with them (`zolw` finds `żółw`, `cafe` finds `café`); pages with the accents as you typed them come first.

In other languages, such as Polish, Russian or Turkish, search finds words only in the form you typed: `żółwie` doesn't find `żółw`. In spaces with semantic search, **Semantic** finds them in any form.

# What is searched
Search covers the Markdown pages in your space, up to 1 MiB each. Built-in library pages bundled with SilverBullet and attachments are not searched.

# The search index
The server keeps a full-text index of the space and updates it as pages change, usually within a second. After the server starts, it builds or catches up the index in the background; until that finishes, results come with a "Search index building" notice and may be incomplete.

Where the index lives:
* On a server with several spaces, under `search/indexes/` in the server's data folder, so restarts reuse it.
* On a single-space server, in memory and rebuilt at every start, or in `SB_SEARCH_DIR` when it is set (see [[#Single-space servers]]).
* In SilverBullet Desktop, in the app’s data folder.

# Semantic search
When enabled (default off), SilverBullet offers semantic search — search based on “meaning”). It runs an embedding model on the server itself (in Desktop, on your computer). Beyond downloading the model, no data leaves your server/desktop. On a server with several spaces, an administrator turns it on in the dashboard; single-space servers and Desktop are covered under [[#Single-space servers]] and [[#SilverBullet Desktop]].

1. In the dashboard, open **Admin** → **Search** and choose a model.
2. To keep a space on full-text search only, open its settings, go to **Search** and uncheck **Semantic search**.

After selecting a model, it is downloaded once. Choosing a model turns semantic search on for every space by default; the dashboard asks first, saying how many spaces will build a semantic index.

Once the semantic index is ready, a **Related Pages** panel becomes available (toggle it with `Navigate: Related Pages`). It lists up to 5 content pages. From [[Space Lua]], `search.related()` returns the same list (see [[API/search]]).

| Model | Languages | Download | Memory (about) |
|---|---|---|---|
| `granite-embedding-97m-multilingual-r2` (default) | 52, and 200+ with less training | 220 MB | 490 MB |
| `multilingual-e5-small` | about 100 | 488 MB | 590 MB |

Granite Embedding 97M Multilingual R2 (IBM, Apache-2.0) is the recommended model and comes first in the list; it finds paraphrases and pages in other languages better. Multilingual E5 Small (MIT) stays available, and a server, space or Desktop already set to it keeps using it. Switching to another model builds new semantic indexes.

Semantic search is good at paraphrases, questions and other languages; for names, codes and exact wording, **All words** and **Exact phrase** stay the better choice.

## SilverBullet Desktop
Open **Settings → Advanced** and choose a model under **Semantic search**; the download starts right away. Semantic search is then on for every space; to keep a space on full-text search only, open its settings, go to **Advanced** and uncheck **Semantic search**. The same 5,000-page rule applies. Changing the model reloads the open spaces, after asking first. The model and the indexes live in the app's data folder.

# Space Lua and the command line
The same search is available from [[Space Lua]] as `search.status()` and `search.find()`. See [[API/search]].

From the command line, run it with `sb eval` (see [[CLI]]):

```bash
sb eval 'search.find("garden plan")'
sb eval 'search.find("flat tire", {mode = "phrase", limit = 10})'
```

The result is JSON with `items` (each with `page`, `line`, `excerpt` and more) and `total`.
