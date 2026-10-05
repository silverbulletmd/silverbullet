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
function widget.markdown(markdown)
  return widget.new {
    markdown = markdown
  }
end

function widget.markdownBlock(markdown)
  return widget.new {
    markdown = markdown,
    display = "block"
  }
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
