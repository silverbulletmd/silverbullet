---
description: The quick-open dialog for navigating to any page.
tags: glossary
references:
- client/navigator/builtins.ts
- plugs/editor/page.ts
---
The page picker has two main functions:

1. Enables quick navigation between [[Page]]
2. Enables creation of new pages
   * Based on the entered name
   * Based on [[Link|linked]] to, but not yet created page names

The page picker can be invoked by clicking the 📔 icon in the top bar, or by pressing `Cmd-k` on Mac, or `Ctrl-k` on Windows/Linux.

The main input is the **filter phrase** and can be used to narrow down the list of page results.

If the filter phrase contains `#tags` the results will be filtered based on matching those tags.

If the filter phrase starts with `$`, the picker switches to navigating [[Markdown/Anchor|anchors]] instead of pages: everything after the `$` filters anchor names from across your [[Space]], and each result shows a snippet of the anchored content along with the host page it lives on. Deleting the `$` returns you to the page list. This works from any of the pickers.

> **note** Note
> Any page tagged with a tag starting with `#meta`, even though technically regular pages, will **not** appear in the page picker. To navigate to them, use the [[Meta Picker]] instead.

Pressing the `Enter` key will open/create the selected page.
Pressing `Shift-Enter` will open or create (if it doesn't already exist) the page _exactly matching_ the filter phrase. In [[Markdown/Anchor|anchor]] and tag mode there is nothing to create, so it does nothing there.

Therefore, if you _intend to create a new page_, simply type the name of the new page and hit `Shift-Enter`.

# Result ordering
When no filter phrase is entered, pages are ordered by either _last opened_, or _last modified_ date in descending order. This makes it convenient to switch between recently edited pages.

When entering a filter phrase, the best matches should appear closer to the top, however the second option will always be an option to create a new page with _exactly_ the page name entered as the filter phrase.

# Keyboard shortcuts
* `Enter`: selects the highlighted page from the list and navigate there. If that page is marked with a `Create` chip it will create that page.
* `Shift-Enter`: navigate to the page entered in as the filter phrase, creating it if it doesn't already exist. Does nothing in anchor or tag mode, where there is nothing to create.
* `Space`: with an empty filter phrase will attempt to do something intelligent:
  * If the currently opened page is nested in a [[Folder|folder]], it will auto complete the current folder name in its place.
  * If the currently opened page name starts with an emoji, it will complete that emoji in its place.
  * Otherwise, it will complete the full page name of the currently open page.
* Typing `$` at the start of the filter phrase switches to [[Markdown/Anchor|anchor]] navigation
* `ArrowUp`/`ArrowDown`: move up and down the highlighted page list
* `PageUp`/`PageDown`: move up and down 5 entries in the page list in one go
* `Home`: moves to the start of the list
* `End`: moves to the end of the list
* `Escape`: clears the filter phrase; on an empty phrase it closes the page picker
* Typing `^` when the filter phrase is empty switches to the **Meta** segment ([[Meta Picker]]); `Tab`/`Shift-Tab` step through all four segments

# Mouse/touch operation
You can scroll and select an item from the list by clicking with the mouse, as well as close the page picker by clicking outside of it.

