> **warning** Warning
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

Example: 10 + 2 = ${adder(10, 2)} (move into this value to see the expression using the just defined `adder` function to calculate this).

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
Hell yeah!

## Commands
Custom commands can be defined using `def.command`:

```space-lua
def.command {
  name = "Hello World";
  function()
    editor.flash_notification "Hello world!"
    event.dispatch("my-custom-event", {name="Pete"})
  end
}
```

Try it: {[Hello World]}

## Event listeners
You can listen to events using `def.event_listener`:

```space-lua
def.event_listener {
  event = "my-custom-event";
  function(e)
    editor.flash_notification("Custom triggered: " .. e.data.name)
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