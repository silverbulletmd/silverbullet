---
description: A configurable list/tree navigation UI, built with Space Lua and TypeScript built-ins.
tags: maturity/beta
references:
- client/navigator/*
---
The **navigator** is SilverBullet’s generalized navigation UI: it takes any collection of [[Object|objects]] and shows it as a fuzzy-filterable **list** or **tree**, either as a modal overlay or as a sidebar that stays open. The [[Feature/Page Picker]], the [[Feature/Command Palette]], and many others are all built on this abstraction.

# Built-in navigators
* [[Feature/Page Picker]]: `Cmd-k`/`Ctrl-k`. The whole space as a modal list, most recently opened first.
* [[Feature/Command Palette]]: `Cmd-/`/`Ctrl-/`. What you ran most recently first, each row showing its key binding.
* **Anchor picker**: type `$` into the page picker. Every [[Markdown/Anchor]] in the space, with the line it sits on.
* **Tag picker** — `Ctrl-Alt-t`, or `#` from the page picker. Every tag, with how many things carry it.
* ${widgets.commandButton("Navigate: Tree")}: `Cmd-o`/`Ctrl-o`, or `Cmd-Shift-o`/`Ctrl-Shift-o`. The space as a tree in the left sidebar, following the editor as you navigate. Drag rows to move pages, hover or select a row for rename/delete/new-page buttons, `Space` to peek at a row without leaving the panel. On Safari, `Cmd-O` is reserved by the app at the OS level, so web content never even sees the keydown — use `Cmd-Shift-O` there instead; `Cmd-O` works normally in the desktop App and every other browser.
* ${widgets.commandButton("Navigate: Outline")}: the current page’s headers as a tree, fully expanded and live as you type. Opens as a modal by default; use its dock menu to pin it to a sidebar instead, which is remembered from then on. (`Navigate: Outline Picker` is a hidden alias for the same command, kept for muscle memory.)

# Using a view

* `Up` / `Down` (or `Ctrl-p` / `Ctrl-n`) move the selection, `PageUp` / `PageDown` by five, `Home` / `End` to the ends.
* `Enter` opens the selected row. `Escape` closes the panel, whether or not you have typed anything.
* Typing ranks rows fuzzily, highlighting the matched characters in each row’s name, list or tree alike.
* In a tree, `Right` expands (or steps into) a folder and `Left` collapses it (or steps out to its parent). `Enter` on a plain folder expands it, on a folder that is *also* a page it opens the page.
* `Tab` / `Shift-Tab` step through the segments.
* `Shift-Enter` creates whatever you typed, in views that allow it. A create row also appears on its own: second in a list, pinned below the tree in a tree.
* The **first character typed into an empty box can route**:
  * `^` narrows the page picker to [[Concept/Meta Page|meta pages]].
  * `$` opens the anchor picker
  * `#` the tag picker
* In the page picker, `Space` on an empty phrase inserts the folder you are currently in, and `Alt-Space` extends the phrase by one more path segment of the best match. A `#tag` anywhere in the phrase filters by tag rather than matching names.

In a tree that supports it: drag a row onto a folder to move it (renaming through SilverBullet’s own machinery, so backlinks follow).

# Custom navigators
You can define custom navigators with [[Space Lua]]. Example, adding a task navigator modal:
```lua
navigator.define {
  name = "tasks",
  title = "Open tasks",
  command = "Navigate: Open Tasks",
  dock = "modal",
  source = function()
    return query [[
      from t = index.tasks()
      where not t.done
      order by t.page
    ]]
  end,
  presentation = {
    mode = "list",
    row = {
      primary = "name",
      description = "page"
    }
  },
  onSelect = function(task)
    editor.navigate(task.ref)
  end,
}
```

`name`, `source` and `onSelect` are the only required keys, `command` registers a [[Concept/Command]] that opens the view, and `key`/`mac` define a key binding for it. Open one from anywhere Lua runs with `navigator.open("tasks")`.

See **[[API/navigator]] for the full field reference**: every key of `spec` and of `presentation`, with what each one does.

# Docks
`dock` decides where a view opens.

* `"modal"` (the default) is a centered overlay. It clears its phrase on open and dismisses when you pick something.
* `"lhs"` / `"rhs"` are sidebars that persist. They are resizable by their inner edge, the width is remembered per view, and they keep their filter phrase across a re-focus.

Whichever sidebars are open when a client shuts down open again on its next boot, one per side.

On **narrow screens** (below 600px) a sidebar becomes a full-width drawer over the editor that dismisses on selection, and boot restore is skipped there.