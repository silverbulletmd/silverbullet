#api/space-lua #maturity/experimental

Enables defining simple custom syntax extensions to [[Markdown]]. Custom syntax lets you define new delimiter-based regions (both inline and block) that are recognized by the parser and can be styled or rendered as [[Space Lua/Widget|Widgets]].

# API
## syntax.define(spec)
Registers a custom syntax extension. The extension will be active after the next editor state rebuild (e.g. on page reload or config change).

`spec` is a table that can contain:
* `name` (required): AST node name (e.g. `"LatexInline"`)
* `startMarker` (required): Regex string for start delimiter (e.g. `"\\$"`)
* `endMarker` (required): Regex string for end delimiter
* `mode` (required): `"block"` or `"inline"`
* CSS styling used when _not_ [[Live Preview|Live Previewing]]:
  * `startMarkerClass`: CSS class for the start marker
  * `bodyClass`: CSS class for the body content between markers
  * `endMarkerClass`: CSS class for the end marker
* CSS styling applied when Live Previewing:
  * `renderClass`: CSS class applied to the rendered widget
* `renderWidget`: Callback `function(body, pageName)` returning [[API/widget|widget]] content for Live Preview.
* `renderHtml`: Callback `function(body, pageName)` returning an HTML string or `HTMLElement` (e.g. via `dom.*`) for use when rendering to HTML.

# Escaping
Within the body of an inline syntax extension, backslash (`\`) acts as an escape character. Use `\` before the end marker to include it literally in the body. The render callback receives the **raw** body text with escape sequences intact; the renderer is responsible for unescaping if needed.

# Example
Define an inline LaTeX syntax using `$` delimiters:

```space-lua
syntax.define {
  name = "LatexInline",
  startMarker = "\\$(?!\\{)",
  endMarker = "\\$(?!\\{)",
  mode = "inline",
  --startMarkerClass = "sb-latex-mark",
  --bodyClass = "sb-latex-body",
  --endMarkerClass = "sb-latex-mark",
  renderClass = "sb-latex-inline-preview",
  renderWidget = function(body, pageName)
    return widget.html(dom.i { body })
  end,
  renderHtml = function(body, pageName)
    return dom.i { body }
  end
}
```

This will recognize `$E=mc^2$` in your text and render the body using the provided callback (in this case it just makes it italic): $E=mc^2$.

> **note** Note
> The `(?!\{)` negative lookahead prevents `$` from clashing with the `${expr}` Lua expression syntax. Without it, `$math ${expr} more$` would prematurely close at the `$` in `${expr}`.

A block-level variant using `$$` fences:

```space-lua
syntax.define {
  name = "LatexBlock",
  startMarker = "^\\|\\|$",
  endMarker = "^\\|\\|$",
  mode = "block",
  startMarkerClass = "sb-latex-mark",
  bodyClass = "sb-latex-body",
  endMarkerClass = "sb-latex-mark",
  renderWidget = function(body, pageName)
    return widget.htmlBlock(dom.marquee { body })
  end,
  renderHtml = function(body, pageName)
    return dom.marquee { body }
  end
}
```

This recognizes fenced blocks:

||
E = mc^2
||

You can style these with [[Space Style]]:
```space-style
.sb-latex-mark {
  color: cyan;
}
.sb-latex-body {
  color: gray;
}
```
