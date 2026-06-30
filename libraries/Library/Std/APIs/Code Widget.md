---
description: API to define custom renderers for fenced code blocks from Space Lua
tags: meta/api
---
API to define custom renderers for fenced code blocks (code widgets) from Space Lua.

# API

## codeWidget.define(def)
Registers a renderer for fenced code blocks of a given language.

Available keys:

* `language`: The language of the fenced code block to render (the string right after the opening ```` ``` ````).
* `render`: A callback `function(bodyText, pageName)` that receives the body text of the code block and the name of the page it appears on. It returns the same kind of value as a `${...}` directive: either a string (rendered as markdown), or a widget table such as one created with [[^Library/Std/APIs/Widget|widget.new{}]] or `widget.sandbox{}`.

Lua code widgets render through the same pipeline as `${...}` directives, so they get the same Copy/Edit/Reload bar. The Copy button copies the rendered `markdown`.

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

function codeWidget.define(def)
  config.set({"codeWidgets", def.language}, def)
end
```
