#api/space-lua

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

## Sandboxed widgets
For widgets that need to run JavaScript, e.g. to drive a third-party rendering library, set `sandbox = true`. The `html` (and the optional `script`) then run together inside an **isolated sandbox iframe**, so the widget's scripts and styles can't interfere with the editor. (`widget.sandbox` is a shortcut that sets this for you.)

Inside the sandbox the script has access to:
* `syscall(name, ...args)` — call any [[API|syscall]] (returns a promise), e.g. `syscall("editor.navigate", "Some Page")`.
* `loadJsByUrl(url)` — load an external classic script (returns a promise that resolves once loaded).
* automatic height — the iframe sizes itself to its content.

The widget's `markdown` value (if set) is what the **Copy** button copies — handy for exposing a scripted widget's source. Sandboxed widgets render as a block.

```space-lua
function clock()
  return widget.sandbox {
    html = [[<div id="t"></div>]],
    markdown = "Not supported",
    script = [[
      var el = document.getElementById("t");
      setInterval(() => { el.innerText = new Date().toLocaleTimeString(); }, 1000);
    ]],
  }
end
```

${clock()}

# API
## widget.new(spec)
To render a widget, call `widget.new` with a `spec` table setting any of the following keys:

* `markdown`: Renders the value as markdown. For `html`/sandbox widgets it is not displayed but is used as the **Copy** button's content.
* `html`: Renders a HTML DOM as a widget. It is usually used in conjunction with the [[API/dom]] API.
* `sandbox`: When `true`, render `html` (and `script`) inside an isolated sandbox iframe (see [[#Sandboxed widgets]]).
* `script`: JavaScript to run inside the sandbox iframe. Only runs when `sandbox = true`.
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`).
* `cssClasses`: A list of CSS class names to set on the widget's wrapper element.

## widget.markdown(text)
Shortcut for `widget.new { markdown = text }`

## widget.html(htmlOrDOM)
Shortcut for `widget.new { html = htmlOrDOM }`

Usually used in conjunction with [[API/dom]].

## widget.htmlBlock(htmlOrDOM)
Shortcut for `widget.new { html = htmlOrDOM, display = "block" }`

Block-level version of `widget.html`.

## widget.markdownBlock(text)
Shortcut for `widget.new { markdown = text, display = "block" }`

Block-level version of `widget.markdown`. Useful for content that needs to render as a block element (lists, tables, headings, etc.).

## widget.sandbox(spec)
Convenience wrapper for a [[#Sandboxed widgets|sandboxed]] widget — equivalent to `widget.new` with `sandbox = true` (and `display = "block"` by default).

Keys:
* `html`
* `script`
* `markdown` (Copy-button content)
* `cssClasses`
* `display` (defaults to `block`)
