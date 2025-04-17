The `${lua expression}` syntax can be used to implement custom widgets. If the Lua expression evaluates to a simple string, it will live preview as that string rendered as markdown. However, if the expression returns a `widget.new`-generated result value, you can do some fancier stuff.

To render a widget, call `widget.new` with any of the following keys:

* `markdown`: Renders the value as markdown
* `html`: Renders a HTML string as a widget. This is somewhat brittle. Therefore, it’s preferred to use the [[^Library/Std/DOM]] API.
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`)

For convenience there are `widget.markdown` and `widget.html` wrappers available, see below for examples.

## Markdown widgets

## DOM widgets
To render a custom HTML-based widget, use the [[^Library/Std/DOM]] API:

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

Now, let’s use it (try clicking):
${marquee "Finally, marqeeeeeee!"}
