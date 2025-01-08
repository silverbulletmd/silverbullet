> **warning** Experimental
> This is a **highly experimental** feature still under active development. It is documented here primarily for the real early adopters as this feature develops.

Space Lua is a custom implementation of the [Lua programming language](https://lua.org/) embedded in SilverBullet.

# Goals
These are current, long term goals that are subject to change.

* Provide a safe, integrated, productive way to extend SilverBullet’s feature set with a low barrier to entry
* Ultimately succeed [[Space Script]] (for most, if not all) use cases
* Ultimately replace [[Expression Language]] with Lua’s expression language, also in [[Query Language]].
* Ultimately replace [[Template Language]] with a variant using Lua’s control flows (`for`, `if` etc.)

# Use
Space Lua functions analogously to [[Space Script]], [[Space Style]] and [[Space Config]] in that it is defined in fenced code blocks, in this case with the `space-lua` language. As follows:

```space-lua
-- adds two numbers
function adder(a, b)
  return a + b
end
```

Each `space-lua` block has its own local scope, however when functions and variables are not explicitly defined as `local` they will be available from anywhere (following regular Lua scoping rule).

A new syntax introduced with Space Lua is the `${lua expression}` syntax that you can use in your pages, this syntax will [[Live Preview]] to the evaluation of that expression.

Example: 10 + 2 = ${adder(10, 2)} (Alt-click on this value to see the expression using the just defined `adder` function to calculate this).

## Widgets
The `${lua expression}` syntax can be used to implement simple widgets. If the lua expression evaluates to a simple string, it will live preview as that string rendered as simple markdown. However, if the expression returns a Lua table with specific keys, you can do some cooler stuff. The following keys are supported:

* `markdown`: Renders the value as markdown
* `html`: Renders the value as HTML
* `cssClasses`: Attach the specified CSS classes to this element (e.g. using CSS classes defined using [[Space Style]]).
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`)

An example combining a few of these features:

```space-lua
function marquee(text)
  return {
    html= "<marquee>" .. text .. "</marquee>";
    display="block";
    cssClasses={"my-marquee"}
  }
end
```

And some [[Space Style]] to style it:

```space-style
.my-marquee {
  color: purple;
}
```

Now, let’s use it (put your cursor in there to see the code):
${marquee "Finally, marqeeeeeeee!"}
Oh boy, the times we live in!

## Commands
Custom commands can be defined using `define_command`:

```space-lua
define_command {
  name = "Hello World";
  function()
    editor.flash_notification "Hello world!"
    event.dispatch("my-custom-event", {name="Pete"})
  end
}
```

Try it: {[Hello World]}

## Event listeners
You can listen to events using `define_event_listener`:

```space-lua
define_event_listener {
  event = "my-custom-event";
  function(e)
    editor.flash_notification("Custom triggered: "
       .. e.data.name
       .. " on page " .. _CTX.pageMeta.name)
  end
}
```

## Custom functions
Any global function (so not marked with `local`) is automatically exposed to be used in [[Live Queries]] and [[Live Templates]]:

```space-lua
-- This is a global function, therefore automatically exposed
function greet_me(name)
  return "Hello, " .. name
end

-- Whereas this one is not
local function greet_you(name)
  error("This is not exposed")
end
```

Template:
```template
Here's a greeting: {{greet_me("Pete")}}
```

# Thread locals
There’s a magic `_CTX` global variable available from which you can access useful context-specific value. Currently the following keys are available:

* `_CTX.pageMeta` contains a reference to the loaded page metadata (can be `nil` when not yet loaded)

# API
Lua APIs, which should be (roughly) implemented according to the Lua standard.
* `print`
* `assert`
* `ipairs`
* `pairs`
* `unpack`
* `type`
* `tostring`
* `tonumber`
* `error`
* `pcall`
* `xpcall`
* `setmetatable`
* `getmetatable`
* `rawset`
* `string`:
  * `byte`
  * `char`
  * `find`
  * `format`
  * `gmatch`
  * `gsub`
  * `len`
  * `lower`
  * `upper`
  * `match`
  * `rep`
  * `reverse`
  * `sub`
  * `split`
* `table`
  * `concat`
  * `insert`
  * `remove`
  * `sort`
* `os`
  * `time`
  * `date`
* `js` (Warning: this will be revised): JavaScript interop functions
  * `new`: instantiate a JavaScript constructor
  * `importModule`: import a JavaScript from a URL (`import` equivalent)
  * `tolua`: convert a JS value to a Lua value
  * `tojs`: convert a Lua value to a JS value
  * `log`: console.log

In addition, [all SilverBullet syscalls](https://jsr.io/@silverbulletmd/silverbullet/doc/syscalls) are exposed. However since the Lua naming convention prefers using `snake_case` it is recommended you call them that way. For instance: `editor.flash_notification` is more Lua’y than `editor.flashNotification` (although both are supported at this time -- again, subject to change).

While in [[Space Script]] all syscalls are asynchronous and need to be called with `await`, this is happens transparently in Space Lua leading to cleaner code:

```space-lua
local function call_some_things()
  local text = space.read_page(editor.get_current_page())
  print("Current page text", text)
end
```

# Lua implementation notes
Space Lua is intended to be a more or less complete implementation of [Lua 5.4](https://www.lua.org/manual/5.4/). However, a few features are (still) missing:

* `goto` and labels (not planned, goto considered harmful)
* coroutines (not planned, not useful in the SilverBullet context)
* _ENV (planned)
* Full metatable support (only partial now, planned)

# Frequently Asked Questions
## Why Lua?
Lua is purpose-designed to be a simple, [easy to learn](https://www.lua.org/manual/5.4/), yet powerful language for extending existing applications. It is commonly used in the gaming industry, but to extend many other applications. If you know any other programming language, you will be able to learn Lua within hours or less.

## Why a custom Lua runtime?
Rather than using a WebAssembly or other implementation of Lua that could run in the browser and server, we have opted for a custom implementation. This is achievable because Lua is a relatively simple and small language to implement and allows for deep integration in the custom Lua runtime. The thing that triggered a custom implementation was the need to call asynchronous (JavaScipt) APIs from Lua, without having to resort to ugly asynchronous callback-style API design (Lua does not support async-await). In SilverBullet’s Lua implementation, the differences between asynchronous and synchronous APIs is fully abstracted away, which makes for a very clean development experience.