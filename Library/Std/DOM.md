#meta

A library to easily build DOM-based Lua widgets with the magic of Lua meta tables.

# Usage

```lua
-- any HTML tag can be used here
dom.span {
  -- tag attributes can be set like this:
  class = "my-class",
  id = "my-id",
  -- Plain text body elements can be added like this
  "Span content",
  -- And elements can be nested
  dom.strong { "I am strong" }
}
```

# Examples
${dom.marquee{
  "I'm in a ",
  dom.span {
    style="color:red;",
    "marquee"
  }
}}

# Implementation
```space-lua
dom =  setmetatable({}, {
  __index = function(self, tag)
    return function(spec)
      local node = js.window.document.createElement(tag)
      for key, val in pairs(spec) do
        if type(key) == "string" then
          -- This is an attribute
          if key:startsWith("on") then
            node.addEventListener(key:sub(3), val)
          else
            node.setAttribute(key, val)
          end
        elseif type(val) == "string" then
          -- Text body
          node.appendChild(js.window.document.createTextNode(val))
        elseif val._isWidget and val.html then
          -- Implicit assumption: .html is a DOM node
          node.appendChild(val.html)
        else
          js.log("Don't know what to do with", val)
          error("Invalid node, see JS console")
        end
      end
      return widget.html(node)
    end
  end
})
```
