#meta

This implements the widget API. For a Lua Directive to be rendered as a widget, you need to return it via `widget.new`.

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
        { type = "object"},
        { type =  "string" }
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
```
