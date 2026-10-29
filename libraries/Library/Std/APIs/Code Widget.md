---
description: API to define custom renderers for fenced code blocks from Space Lua
tags: meta/api
---
API to define custom renderers for fenced code blocks (code widgets) from Space Lua.

# API

## codeWidget.define(def)
Registers a renderer for fenced code blocks of a given language. Repeated calls for the same `language` merge (set a field to `config.unset` to remove it).

Available keys:

* `language`: The language of the fenced code block to render (the string right after the opening ```` ``` ````).
* `render`: A callback `function(bodyText, pageName)` that receives the body text of the code block and the name of the page it appears on. It returns the same kind of value as a `${...}` directive: either a string (rendered as markdown), or a widget table such as one created with [[^Library/Std/APIs/Widget|widget.new{}]] or `widget.sandbox{}`.

Lua code widgets render through the same pipeline as `${...}` directives, so they get the same ⋯ menu (Edit source, Reload, Copy as Markdown) and re-run when what they read changes. Copy as Markdown copies the rendered `markdown`; widgets with only HTML have none.

Example rendering a string as markdown:

```lua
codeWidget.define {
  language = "greet",
  render = function(bodyText, pageName)
    return "Hello, **" .. bodyText .. "**! (on page " .. pageName .. ")"
  end
}
```

A code block like this:

    ```greet
    world
    ```

would then render as "Hello, **world**! (on page ...)".

Data blocks (` ```data ` and ` ```#tag `) render as a form by default (see `renderDataBlock` in [[^Library/Std/APIs/Tag]]). For a ` ```#tag ` block, the first match wins: the tag's own `renderDataBlock`, then a code widget for `#tag` defined here, then the `data` tag's `renderDataBlock` (the form), then the plain YAML. So a code widget for `#tag` keeps working, unless the tag itself defines `renderDataBlock`.

Example producing a rich widget (a mermaid diagram):

```lua
codeWidget.define {
  language = "mermaid",
  render = function(bodyText)
    return widget.html(dom.div {
      class = "mermaid",
      bodyText
    })
  end
}
```

# Implementation
Most of the heavy lifting happens in SB itself. This is just a thin wrapper around the config object API: it writes the definition into `config` under `codeWidgets.<language>`.

```space-lua
-- priority: 99
codeWidget = codeWidget or {}

--- Registers a renderer for fenced code blocks of a given language, or merges `def` into an existing one.
--- @param def table { language: string, render: function(bodyText, pageName) }; `render` returns a Markdown string or a widget
--- @see API/codeWidget
function codeWidget.define(def)
  config.merge({"codeWidgets", def.language}, def)
end
```
