---
description: API to define custom syntax extensions
tags: meta/api
---

# API
## syntax.define(spec)
Registers a custom syntax extension. The extension will be active after the next editor state rebuild (e.g. on page reload or config change).

Available keys:
* `name`: AST node name (e.g. "LatexBlock")
* `startMarker`: Regex string for start delimiter (e.g. `"\\$\\$"`)
* `endMarker`: Regex string for end delimiter
* `mode`: `"block"` or `"inline"`
* `startMarkerClass`: (optional) CSS class for the start marker
* `bodyClass`: (optional) CSS class for the body content between markers
* `endMarkerClass`: (optional) CSS class for the end marker
* `renderClass`: (optional) CSS class applied to the rendered widget
* `renderWidget`: (optional) Callback `function(body, pageName)` returning widget content for live editor preview. Previously named `render`, which is still supported for backwards compatibility.
* `renderHtml`: Callback `function(body, pageName)` returning an HTML string or `HTMLElement` (e.g. via `dom.*`) for use when rendering to HTML.

# Implementation
```space-lua
-- priority: 99
syntax = syntax or {}

function syntax.define(spec)
  if not spec.name then error("syntax.define requires 'name'") end
  if not spec.startMarker then error("syntax.define requires 'startMarker'") end
  if not spec.endMarker then error("syntax.define requires 'endMarker'") end
  if not spec.mode then error("syntax.define requires 'mode'") end
  config.set({"syntaxExtensions", spec.name}, spec)
end
```
