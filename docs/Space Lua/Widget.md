---
description: A rendered UI component (markdown or HTML).
tags: glossary
references:
- client/space_lua/render_widget.ts
- client/codemirror/lua_widget.ts
---
The `${lua expression}` syntax can be used to implement custom widgets. If the Lua expression evaluates to a simple string, it will live preview as that string rendered as markdown. However, if the expression returns a `widget.new`-generated result value, you can do some fancier stuff.

# Widget types
To render a widget, call `widget.new` with any of the following keys:

* `markdown`: Renders the value as markdown
* `html`: Renders an HTML string or DOM element as a widget
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`)
* `cssClasses`: Array of CSS class names to add to the widget container

# Convenience functions
For common cases, use these shortcuts instead of `widget.new` directly:

| Function | Description |
|---|---|
| `widget.markdown(md)` | Inline markdown widget |
| `widget.markdownBlock(md)` | Block-level markdown widget |
| `widget.html(html)` | Inline HTML widget |
| `widget.htmlBlock(html)` | Block-level HTML widget |

# Markdown widgets
The simplest widget type renders markdown:

```lua
${widget.markdown("**Bold** and *italic* text")}
```

For block-level content (like lists or tables), use `widget.markdownBlock`:

```lua
${widget.markdownBlock("## A heading\n* Item 1\n* Item 2")
```

# HTML and DOM widgets
For full control over the rendered output, use HTML widgets with the [[Space Lua/DOM|DOM builder API]]:

```space-lua
function marquee(text)
  return widget.html(dom.marquee {
    class = "my-marquee",
    onclick = function()
      editor.flashNotification "You clicked me"
    end,
    text
  })
end
```

We can combine this with some [[Concept/Space Style]] to style it:

```space-style
.my-marquee {
  color: purple;
}
```

Now, let's use it (try clicking):
${marquee "Finally, marqeeeeeee!"}

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
These are [[Feature/Navigator]] views, not automatic page decorations. Each ships docked into the page and can be moved to a sidebar or a modal from its own dock menu, closed with its ×, or folded to its title bar:

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

# Creating custom top/bottom widgets
You can add your own widgets to the top or bottom of every page by listening to the rendering events:

```lua
event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    return widget.new {
      markdown = "This appears at the top of every page!"
    }
  end
}
```

See also: [[Space Lua/DOM]], [[API/widget]], [[API/dom]]
