#meta/api

This implements the widget API. Widgets are values describing what to render: static (markdown, html) or live (source, content). See [[View#Widgets and views]]. Consider using [[^Library/Std/APIs/DOM]] to construct HTML widgets.

```space-lua
-- priority: 50

widget = widget or {}

widgets = {}

local widgetSchema = {
  type = "object",
  properties = {
    markdown = { type = "string"},
    html = {
      anyOf = {
        -- HTMLElement
        { type = "object"},
        -- Plain HTML code
        { type = "string" }
      }
    },
    cssClasses = {
      type = "array",
      items = { type = "string" },
    },
    display = {
      type = "string",
      enum = {"block", "inline"}
    },
    events = {
      type = "object",
      additionalProperties = true
    },
    -- false renders markdown without evaluating it: Lua directives, custom
    -- syntax and transclusions stay literal (for user- or agent-written text).
    evaluate = { type = "boolean" },
    -- A fragment: text parts and embedded widgets (from .., table.concat, templates)
    parts = { type = "array" },
    -- When true, html + script render inside an isolated sandbox iframe.
    sandbox = { type = "boolean" },
    script = { type = "string" },
  }
}

-- Creates a widget
function widget.new(spec)
  if spec.source ~= nil or spec.content ~= nil then
    return widget.newLive(spec)
  end
  if type(spec.markdown) == "table" and spec.markdown._isWidget then
    local f = {}
    for k, v in pairs(spec.markdown) do f[k] = v end
    f.display = spec.display or f.display
    f.cssClasses = spec.cssClasses or f.cssClasses
    return f
  end
  local validationResult = jsonschema.validateObject(widgetSchema, spec)
  if validationResult then
    error(validationResult)
  end
  spec._isWidget = true
  return spec
end

-- Convenience function for HTML widgets
function widget.html(html)
  return widget.new {
    html = html
  }
end

function widget.htmlBlock(html)
  return widget.new {
    html = html,
    display = "block"
  }
end

-- Convenience function for markdown widgets
-- opts.evaluate = false renders the Markdown without evaluating it.
function widget.markdown(markdown, opts)
  return widget.new {
    markdown = markdown,
    evaluate = opts and opts.evaluate
  }
end

function widget.markdownBlock(markdown, opts)
  return widget.new {
    markdown = markdown,
    display = "block",
    evaluate = opts and opts.evaluate
  }
end

--- A value that re-renders its whole expression on `refreshOn` events
--- (default: index changes). Use it only around what you render.
function widget.live(value, refreshOn)
  return { _isWidget = true, live = { value = value, refreshOn = refreshOn or { "index" } } }
end

-- A sandboxed, scripted widget: html + script run inside an isolated iframe
-- (the same machinery code widgets use). `script` has access to syscall(),
-- loadJsByUrl, and auto height. The Copy button copies `markdown`. Equivalent to
-- `widget.new` with `sandbox = true`.
function widget.sandbox(spec)
  return widget.new {
    sandbox = true,
    html = spec.html,
    script = spec.script,
    display = spec.display or "block",
    markdown = spec.markdown,
    cssClasses = spec.cssClasses,
  }
end
```
