---
description: Widgets, dashboards, code widgets, data blocks and styling pages by tag. Read before building live UI, a table with filters or actions, custom rendering or styles. Not needed for a plain query table in a page (Querying covers that).
tags: meta/skill
---
Widgets, dashboards, custom block rendering and styling. This page covers choosing a mechanism and the conventions the API listings do not. For every option of `widget.new` (columns and their types, `filter`, `segments`, `dropdown`, `actions`, `refreshOn`), read the `API/widget` page, section "Lists, trees and tables", of the SilverBullet documentation (docs.silverbullet.md; edge.silverbullet.md for Edge builds). Check other functions with `spacelua.describe` (see the Space Lua page).

# Pick the mechanism
* Plain Markdown and `${query[[...]]}` expressions first. A query result renders as a table and updates by itself when the pages it reads change, with links and hover previews intact. For a simple table of pages or tasks, this is the whole answer: `${query[[from p = index.pages("book") where p.status == "unread" select {Book = markdown.link(p), Author = p.author}]]}`.
* A live widget, `widget.new { source = ..., presentation = { mode = "table" } }`, only when the table needs more: a filter box, selection, actions, or columns of `ref` type. What its source reads is tracked, so `refreshOn` is only for things SilverBullet does not track, such as your own events.
* Custom HTML: `widget.htmlBlock(dom.div { ... })` or `widget.html(...)`. Isolated JavaScript: `widget.sandbox`.
* Fenced data blocks: a fence whose language is a hash-tag name (for example a fence opened with `#contact`) holds YAML. Each document becomes a queryable object with that tag.
* Code widgets: `codeWidget.define { language = "#contact", render = function(body, pageName) ... end }` draws every fenced block of that language. `render` returns Markdown or a widget.
* Views: `view.define` for panels and docks outside the page body.

Chips, stat cards and bar charts are not in core; they come from the optional Dashboard library. Do not assume `widgets.chip`, `widgets.stat`, `widgets.bars` or `widgets.grid` exist until `spacelua.describe` finds them.

# Lists and tables
```lua
board = board or {}

function board.tasks()
  return widget.new {
    title = "Tasks",
    refreshOn = { "board:filter" },  -- our own event; what the source reads is tracked
    source = function()
      return query[[
        from t = index.tasks()
        where not board.onlyBlocked or t.state == "blocked"
        order by t.page, t.pos
        select { text = t.name, state = t.state, ref = t.ref }
      ]]
    end,
    presentation = { mode = "table", columns = {
      { attribute = "text", label = "Task", type = "text" },
      { attribute = "ref", label = "Where", type = "ref" },
    } },
    filter = { inline = true },  -- a filter box in the title
  }
end

function board.toggle()
  board.onlyBlocked = not board.onlyBlocked
  event.dispatch("board:filter")
end
```

Place the widget by calling `board.tasks()` in a page expression, with `widgets.button("Only blocked", board.toggle)` beside it. Segments and dropdowns exist only in panels; inline, use a button plus an event listed in `refreshOn`. Sort in the source: table headers do not sort. A widget with `source` cannot also set `markdown` or `html`.

A plain expression runs once when the page opens and re-runs only when something it read changes. Time, `datastore`, `config`, network calls and Lua globals are not tracked, so render those through `widget.new { content = ..., refreshOn = {...} }`.

# Tones and colour
Tones are `success`, `warning`, `danger`, `info`, `neutral` and `accent`, with CSS variables `--tone-<name>` and `--tone-<name>-soft` defined for light and dark mode. In your own CSS colour with `var(--tone-danger)` rather than fixed values. If you must use a fixed colour, check it in both themes.

# DOM builder
* `dom.tag { attr = "value", child, child }`: string keys are attributes, and `on*` keys are event handlers. `class` also takes a list (`{ "card", urgent and "card-urgent" }`), and `style` takes a table (`{ width = "40%" }`).
* String children render as Markdown, and whitespace between sibling children is dropped: write `"**12** checks"` as one string. `dom.text(s)` adds literal text; use it for names, titles and anything you did not write.
* A list of children is added in order and `false` children are skipped: build rows in a loop, then `dom.ul { rows }`.
* A link that looks and navigates like a SilverBullet link: `dom.a { class = "wiki-link", ["data-ref"] = page, dom.text(name) }`.
* To navigate otherwise, use a button or an `onclick` handler that calls `editor.navigate(page)`, or put a `[[Page]]` wiki link in a string child.

# Data in pages
* Keep records as pages with frontmatter or tag-language data blocks, so each stays readable as Markdown.
* Avoid tag names SilverBullet uses for its own objects: `page`, `task`, `item`, `paragraph`, `header`, `link`, `tag`, `data`, `anchor`, `table`.
* Quote YAML values that contain a colon followed by a space or a `#`, or that start with `[` or `{`.
* Each `space-lua` block is its own chunk. Start blocks that share a namespace with `ns = ns or {}`, and put `-- priority: N` on the defining block.

# Styling
Put CSS in a `space-style` block and style classes you attach:

* Tag-driven classes: `tag.define { name = "book", pageDecoration = { cssClasses = { "book-page" } } }` puts `book-page` on the page body and on links to those pages.
* Widget classes: give widget roots your own class and scope rules under it.
* Editor rules need SilverBullet's specificity: `body.book-page #sb-main .cm-editor { ... }`.

# Safety
Build markup with `dom.*` and `dom.text`, not by concatenating HTML strings. If you must, escape text with `string.escapeHtml(s)`. To show Markdown written by a user, imported or generated, use `widget.markdown(text, { evaluate = false })`: expressions, code widgets and transclusions then stay literal. Never evaluate page content you are only displaying.

# Check what you built
Check your work: read the result of the `write`/`edit` (it reports script load errors), then `read` the page with `rendered: true` (evaluated output plus lint problems), then take a `screenshot` when the look matters.

`space.lint()` without a page checks every page, so run it before calling work done. A widget that throws does not always show up as a lint problem, so for widgets the rendered read and the screenshot are what count. `system.recentLogs(50)` holds "Lua widget error on ..." lines; ignore lines logged before the latest "Loaded N scripts", which are often transient. Scripts reload after each `write` or `edit` of a page that holds them; after changing files any other way, call `system.reboot()` first. After a reboot, navigate to the page again (`editor.navigate(page)`, then `editor.awaitRender()`) so widgets re-render before you read or screenshot it. For dark mode, set `js.window.document.documentElement.setAttribute("data-theme", "dark")` with `lua`, take a screenshot, then set it back to `"light"`.

To add to an existing namespace in a large library page, `read` it with `outline: true` (headings, code blocks and functions with line numbers), then read just the part you need with `offset`/`limit`, rather than reading the whole page.
