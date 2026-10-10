#meta/api

A library to easily build DOM objects through the magic of Lua meta tables.

# Usage

```lua
-- any HTML tag can be used here
dom.span {
  -- tag attributes can be set like this:
  class = "my-class",
  -- class also takes a list (false entries are skipped), and style a table of
  -- CSS properties, custom properties included:
  -- class = { "card", isUrgent and "card-urgent" },
  -- style = { width = "40%", ["--accent"] = "teal" },
  id = "my-id",
  -- Plain text body elements can be added like this (rendered as markdown)
  "Span content",
  -- Use __rawText to add plain text without markdown processing
  __rawText = "1. This won't become a list",
  -- dom.text adds literal text (no markdown) in its place among the children
  dom.text("**not bold**, <b>not HTML</b>"),
  -- And elements can be nested
  dom.strong { "I am strong" },
  -- A list of children is added in order, false (false or nil) children are skipped
  { dom.em { "one" }, dom.em { "two" } },
  showMore and dom.small { "more" },
  -- Widgets can also be embedded
  widget.html "<b>Bold</b>",
  widget.html(dom.marquee { "nested widget" })
}
```

# Example
${widget.html(dom.marquee{
  "I'm in a ",
  dom.span {
    style="color:red;",
    "marquee"
  }
})}

# Implementation
```space-lua
-- priority: 50

local function appendHtmlNode(parent, html)
  local htmlNode = js.window.document.createElement("dummy")
  parent.appendChild(htmlNode)
  htmlNode.outerHTML = html
end

-- Adds one child: markdown for strings, literal text for dom.text, HTML
-- widgets and DOM nodes as they are, other widgets rendered live, lists of
-- children in order; nil/false skipped
local function appendChild(node, val)
  if val == nil or val == false then
    return
  end
  if type(val) == "string" then
    appendHtmlNode(node, markdown.markdownToHtml(val, {expand=true}))
  elseif type(val) == "table" and val._isWidget and val.html == nil then
    node.appendChild(markdown.renderToDom(val))
  elseif type(val) == "table" and val._isWidget then
    if type(val.html) == "string" then
      appendHtmlNode(node, val.html)
    else
      node.appendChild(val.html)
    end
  elseif type(val) == "table" then
    for _, child in ipairs(val) do
      appendChild(node, child)
    end
  else
    node.appendChild(val)
  end
end

local function setAttr(node, key, val)
  if val == nil or val == false then
    return
  end
  if key == "class" and type(val) == "table" then
    local names = {}
    for _, name in ipairs(val) do
      if name then table.insert(names, name) end
    end
    node.setAttribute("class", table.concat(names, " "))
  elseif key == "style" and type(val) == "table" then
    for prop, value in pairs(val) do
      if value ~= nil and value ~= false then
        node.style.setProperty(prop, tostring(value))
      end
    end
  else
    node.setAttribute(key, val)
  end
end

dom = setmetatable({
  -- Literal text: shown as is, never as markdown or HTML
  text = function(s)
    return js.window.document.createTextNode(tostring(s))
  end,
}, {
  __index = function(self, tag)
    return function(spec)
      local node = js.window.document.createElement(tag)
      for key, val in pairs(spec) do
        if type(key) == "string" then
          if key == "__rawText" then
            node.appendChild(js.window.document.createTextNode(val))
          elseif key:startsWith("on") then
            node.addEventListener(key:sub(3), val)
          else
            setAttr(node, key, val)
          end
        else
          appendChild(node, val)
        end
      end
      return node
    end
  end
})
```
