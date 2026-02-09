APIs to define widgets in SilverBullet, often used through [[Space Lua#Expressions]].

# Widget types
## Markdown widgets
When setting a `markdown` key, or using the `widget.markdown` API, a markdown-based widget can be created.

Example:

```space-lua
function helloWorld(name)
  return widget.markdown("Hello world, *" .. name .. "*!")
end
```

Can be used as follows:

${helloWorld("Pete")}

## DOM widgets
To render a custom HTML-based widget, use the [[API/dom]] elements passed as an argument to `widget.html`:

```space-lua
function marquee(text)
  return widget.html(dom.marquee {
    class = "my-marquee",
    onclick = function()
      editor.flashNotification "You clicked me"
    end,
    text
  })
end
```

We can combine this with some [[Space Style]] to style it:

```space-style
.my-marquee {
  color: purple;
}
```

This can be used as follows:
${marquee "Finally, marqeeeeeee!"}
# API
## widget.new(spec)
To render a widget, call `widget.new` with a `spec` table setting any of the following keys:

* `markdown`: Renders the value as markdown
* `html`: Renders a HTML DOM as a widget. It is usually used in conjunction with the [[API/dom]] API.
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`).

## widget.markdown(text)
Shortcut for `widget.new { markdown = text }`

## widget.html(htmlOrDOM)
Shortcut for `widget.new { html = htmlOrDOM }`

Usually used in conjunction with [[API/dom]].
