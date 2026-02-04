An API to easily build DOM objects through the magic of Lua meta tables.

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

* `attribute=value` key/value mappings are translated to HTML DOM attribtutes.
* Plain text elements such as `"Hello **world**"` are parsed and rendered as markdown translated to HTML.
* DOM elements (for instance those resulting from additional `dom.*` calls) are injected in place.
* [[API/widget|widgets]] are rendered in place.

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