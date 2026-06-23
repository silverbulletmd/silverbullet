---
description: A rendered UI component (markdown or HTML).
tags: glossary
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

We can combine this with some [[Space Style]] to style it:

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

## Top and bottom widgets
These render automatically on every page and can be configured:

* **Table of contents** — shows a table of contents at the top of the page
* **Linked mentions** — shows pages that link to the current page at the bottom
* **Linked tasks** — shows incomplete tasks that mention the current page at the top

Configure them in your [[^Library/Std/Config]] page:

```lua
-- Disable TOC altogether
config.set("std.widgets.toc.enabled", false)
-- Only render a TOC when there's >= 5 headers
config.set("std.widgets.toc.minHeaders", 5)
-- Disable linked mentions
config.set("std.widgets.linkedMentions.enabled", false)
-- Disable linked tasks
config.set("std.widgets.linkedTasks.enabled", false)
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
