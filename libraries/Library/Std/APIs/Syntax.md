---
description: API to define custom syntax extensions
tags: meta/api
---

# API
## syntax.define(spec)
Registers a custom syntax extension. The extension will be active after the next editor state rebuild (e.g. on page reload or config change). Repeated calls with the same `name` merge (set a field to `config.unset` to remove it), so `startMarker`, `endMarker` and `mode` can come from an earlier call.

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

--- Registers a custom syntax extension, or merges `spec` into an existing one with the same name; active after the next editor state rebuild.
--- @param spec table { name: string, startMarker: string, endMarker: string, mode: "block"|"inline", startMarkerClass?: string, bodyClass?: string, endMarkerClass?: string, renderClass?: string, renderWidget?: function(body, pageName), renderHtml?: function(body, pageName) }; markers are regex strings
--- @see API/syntax
function syntax.define(spec)
  if not spec.name then error("syntax.define requires 'name'") end
  -- Required fields may come from an earlier definition of the same name
  local existing = config.get({"syntaxExtensions", spec.name}, {})
  for _, key in ipairs({"startMarker", "endMarker", "mode"}) do
    local value = spec[key]
    if value == nil then value = existing[key] end
    if value == nil or value == config.unset then
      error("syntax.define requires '" .. key .. "'")
    end
  end
  config.merge({"syntaxExtensions", spec.name}, spec)
end
```
