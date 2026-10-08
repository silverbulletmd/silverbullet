---
tags: api/space-lua
references:
- libraries/Library/Std/APIs/DOM.md
- client/space_lua/render_widget.ts
---
An API to easily build DOM objects through the magic of Lua meta tables.

# Usage

```lua
-- any HTML tag can be used here
dom.span {
  -- tag attributes can be set like this:
  class = "my-class",
  id = "my-id",
  -- Plain text body elements can be added like this (rendered as markdown)
  "Span content",
  -- Literal text, never interpreted:
  dom.text("**not bold**"),
  -- And elements can be nested
  dom.strong { "I am strong" },
  -- Widgets can also be embedded
  widget.html "<b>Bold</b>",
  widget.html(dom.marquee { "nested widget" })
}
```

Example:
${widget.html(dom.marquee {
  "I'm in a ",
  dom.span {
    style="color:red;",
    "marquee"
  }
})}

# API
## dom.* {attribute1=value, attribute2=value, childElement1, childElement2}
Renders a HTML DOM.

* `attribute=value` key/value mappings are translated to HTML DOM attributes. A `nil` or `false` value leaves the attribute out.
* `class` can also be a list: `class = { "card", isUrgent and "card-urgent" }` (`false` entries are skipped).
* `style` can also be a table of CSS properties, custom properties included: `style = { width = "40%", ["--accent"] = "teal" }`.
* `on*` keys (`onclick = function() ... end`) add event listeners.
* Plain text elements such as `"Hello **world**"` are parsed and rendered as markdown translated to HTML.
* `dom.text(s)` adds `s` as literal text: no markdown, no HTML. Use it for anything you didn't write yourself (page names, titles, user input).
* DOM elements (for instance those resulting from additional `dom.*` calls) are injected in place.
* [[API/widget|widgets]] are rendered in place.
* A list of children is added in order, and `nil`/`false` children are skipped, so loops and conditions need no special handling:

```lua
local items = {}
for _, p in ipairs(query[[from p = index.pages("project")]]) do
  table.insert(items, dom.li { dom.text(p.name) })
end
dom.ul { items, showFooter and dom.li { "..." } }
```

## dom.text(s)
Returns a text node holding `s` (converted with `tostring`) exactly as written.

For instance:

```lua
dom.span {
  class = "class-attribute",
  dom.span {
    "A first nested span"
  },
  dom.span {
    "A second nested span"
  },
}
```

Would be roughly equivalent to the following HTML:

```html
<span class="class-attribute">
  <span>A first nested span</span>
  <span>A second nested span</span>
</span>
```

This API is implemented using Lua metatables, its implementation lives here: [[^Library/Std/APIs/DOM]]
