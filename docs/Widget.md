---
description: A rendered UI component (markdown or HTML).
tags: glossary
references:
- client/space_lua/render_widget.ts
- client/codemirror/widgets/lua_widget.ts
---
A widget is a value describing what to render; where it appears is up to the page text or a [[View]]. See [[View#Widgets and views]].

The `${lua expression}` syntax renders whatever the expression returns: a string as Markdown, a table as a table, or a widget. Use `widget.new` when you need more control. The full reference, including how to make an expression re-run on changes with `widget.live`, is in [[API/widget]].

# Widget types
To render a widget, call `widget.new` with any of the following keys:

* `markdown`: Renders the value as markdown
* `html`: Renders an HTML string or DOM element as a widget
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`)
* `cssClasses`: Array of CSS class names to add to the widget container
* `source` or `content`: a list, tree or table, or any value from a function, optionally re-run by `refreshOn` — see [[API/widget#Lists, trees and tables]]

For common cases there are shortcuts: `widget.markdown`, `widget.markdownBlock`, `widget.html` and `widget.htmlBlock`. Custom HTML and DOM widgets, sandboxed widgets and `evaluate = false` are covered in [[API/widget]]. A quick example:

${widget.markdown("**Bold** and *italic* text")}

# The widget menu
Block widgets have a ⋯ menu in their top-right corner (on hover on desktop, always visible on touch devices) for Reload, Copy as Markdown, Bake into page and Make live. Inline results use the *Widget: …* commands instead. See [[API/widget#Widget menu and commands]].

# Built-in widgets
The standard library provides several pre-built widgets in the `widgets` table:

## Buttons
* `widgets.button(text, callback)` — a simple button that runs the callback when clicked
* `widgets.commandButton(commandName)` — a button for a command (button text is the command name)
* `widgets.commandButton(text, commandName)` — a button for a command with custom text
* `widgets.commandButton(text, commandName, args)` — a button for a command with arguments

Example:
${widgets.button("Hello", function()
  editor.flashNotification "Hi there!"
end)}

${widgets.commandButton("System: Reload")}

## Sub-pages widget
* `widgets.subPages(pageName?)` — renders a list of sub-pages (pages with the given prefix). Defaults to the current page.

## Docked widgets
These are [[View|view]]s showing widgets, not automatic page decorations. Each ships docked into the page and can be moved to a sidebar or a modal from its own dock menu, closed with its ×, or folded to its title bar:

* **Linked mentions** — pages that link to the current page, docked at the bottom
* **Linked tasks** — incomplete tasks that mention the current page, docked at the top

The table of contents is no longer rendered on every page either: it's the `Navigate: Table of Contents` view, which you call up when you want it and dock wherever you like.

None of the three has an `enabled` config key: each remembers its own dock and open/closed state, so closing or moving one is what decides whether it appears from then on. The one setting left is in your [[^Library/Std/Config]] page:

```lua
-- Only show a table of contents on pages with >= 5 headers
config.set("std.widgets.toc.minHeaders", 5)
```

# Embed widgets
The `embed` namespace provides widgets for embedding external content:

* `embed.youtube(url)` — embeds a YouTube video
* `embed.peertube(url)` — embeds a PeerTube video
* `embed.vimeo(url)` — embeds a Vimeo video

# Showing a widget above or below every page
Define a view docked at the top or bottom of the page. With `frame = "minimal"` it renders as plain page content, with its buttons appearing on hover:

```lua
view.define {
  name = "example.notice",
  dock = "page-top",
  frame = "minimal",
  content = function()
    return widget.new {
      markdown = "This appears at the top of every page!",
    }
  end,
}
```

Return `nil` from `content` on pages where nothing should show.

**Deprecated:** listening to `hooks:renderTopWidgets` or `hooks:renderBottomWidgets` still works, but those widgets can't be moved, closed or configured. Use a view instead.

See also: [[Space Lua/DOM]], [[API/widget]], [[API/dom]]
