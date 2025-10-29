#meta/api

This implements the widget API. For a Lua Directive to be rendered as a widget, you need to return it via `widget.new`. Consider using [[^Library/Std/APIs/DOM]] to construct these.

```space-lua
-- priority: 50

-- Widget APIs
widget = {}

-- Container for widgets
widgets = {}

-- Widget schema for validation
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
    }
  }
}

-- Creates a widget
function widget.new(spec)
  -- Validate spec
  local validationResult = jsonschema.validateObject(widgetSchema, spec)
  if validationResult then
    error(validationResult)
  end
  -- Mark as a widget
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
```
