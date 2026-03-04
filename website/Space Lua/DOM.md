The DOM builder API provides a clean, declarative way to construct HTML elements from [[Space Lua]]. It is typically used to build [[API/widget|Widgets]] for rendering dynamic UI in your pages.

The full API reference is at [[API/dom]].

# Basic usage
Every HTML tag is available as a function on the `dom` table. Call it with a table of attributes and children:

```lua
dom.div {
  class = "my-container",
  dom.h2 { "Hello!" },
  dom.p { "This is a paragraph." }
}
```

This creates a `<div>` with a class attribute, containing an `<h2>` and a `<p>`.

# Attributes and content
String keys in the table become HTML attributes. Numeric entries become children:

```lua
dom.a {
  href = "https://example.com",
  "Click here"
}
```

**Markdown support**: String children are automatically processed as markdown. So `"**bold**"` renders as bold text.

**Nested elements**: Other `dom.*` calls can be nested as children to build up a tree.

# Event handlers
Attributes starting with `on` are registered as event listeners:

```lua
dom.button {
  onclick = function()
    editor.flashNotification("Clicked!")
  end,
  "Click me"
}
```

This is equivalent to calling `addEventListener("click", fn)` on the button element.

# Rendering as a widget
DOM elements need to be wrapped in a widget to display on a page. Use `widget.html` for inline or `widget.htmlBlock` for block-level:

```lua
-- Inline widget (rendered within text flow)
widget.html(dom.span { class = "badge", "New" })

-- Block widget (gets its own block)
widget.htmlBlock(dom.table {
  dom.tr {
    dom.td { "Name" },
    dom.td { "Value" }
  }
})
```

# Building tables dynamically
A common pattern is building HTML tables from query results:

```lua
local rows = {}
for page in query[[ from index.tag "page" limit 5 ]] do
  table.insert(rows, dom.tr {
    dom.td { "[[" .. page.name .. "]]" },
    dom.td { os.date("%Y-%m-%d", page.lastModified) }
  })
end

return widget.htmlBlock(dom.table {
  dom.thead {
    dom.tr {
      dom.td { "Page" },
      dom.td { "Modified" }
    }
  },
  dom.tbody(rows)
})
```

# Embedding widgets inside DOM
Widget objects (like buttons from `widgets.button`) can be nested inside DOM elements:

```lua
dom.div {
  "Status: ",
  widgets.button("Refresh", function()
    editor.invokeCommand("System: Reload")
  end)
}
```

# How it works
Under the hood, `dom` uses a Lua metatable so that any property access (e.g. `dom.span`) returns a constructor function. That function calls `js.window.document.createElement(tag)` and processes the spec table to set attributes, add event listeners, and append children.

See also: [[API/dom]], [[API/widget]], [[Space Lua/Widget]]
