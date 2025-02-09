> **warning** Experimental
> This is a **highly experimental** feature still under active development. It is documented here primarily for the real early adopters as this feature develops.
> 
> If you want to experiment, be sure to use the [edge builds](https://community.silverbullet.md/t/living-on-the-edge-builds/27/5).

Space Lua is a custom implementation of the [Lua programming language](https://lua.org/), embedded in SilverBullet. It aims to be a largely complete Lua implementation, and adds a few non-standard features while remaining syntactically compatible with “real” Lua.

```embed
url: https://youtu.be/t1oy_41bDAY
```


# Goals
The introduction of Lua aims to unify and simplify a few SilverBullet features, specifically:

* Scripting: replace [[Space Script]] (JavaScript) with a more controlled, simple and extensible language.
* Replace [[Expression Language]], [[Template Language]] and [[Query Language]] with Lua-based equivalents.
* (Potentially) provide an alternative way to specify [[Space Config]]

# Strategy
This is a big effort. During its development, Space Lua will be offered as a kind of “alternative universe” to the things mentioned above. Existing [[Live Templates]], [[Live Queries]] and [[Space Script]] will continue to work as before, unaltered.

Once these features stabilize and best practices are ironed out, old mechanisms will likely be deprecated and possibly removed at some point.

We’re not there yet, though.

# Basics
In its essence, Space Lua adds two features to its [[Markdown]] language:

* **Definitions**: Code written in `space-lua` code blocks are enabled across your entire space.
* **Expressions**: The `${expression}` syntax will [[Live Preview]] to its evaluated value.

## Definitions
Space Lua definitions are defined in fenced code blocks, in this case with the `space-lua` language. As follows:

```space-lua
-- adds two numbers
function adder(a, b)
  return a + b
end
```

Each `space-lua` block has its own local scope. However, following Lua semantics, when functions and variables are not explicitly defined as `local` they will be available globally across your space. This means that the `adder` function above can be used in any other page.

Since there is a single global namespace, it is good practice to manually namespace things using the following pattern:

```space-lua
-- This initializes the stuff variable with an empty table if it's not already defined
stuff = stuff or {}

function stuff.adder(a, b)
  return a + b
end
```

> **note** Tip
> All your space-lua scripts are loaded on boot, to reload them without reloading the page, simply run the {[System: Reload]} command.

## Expressions
A new syntax introduced with Space Lua is the `${lua expression}` syntax that you can use in your pages. This syntax will [[Live Preview]] to the evaluation of that expression.

For example: 10 + 2 = ${adder(10, 2)} (Alt-click, or select to see the expression) is using the just defined `adder` function to this rather impressive calculation. Yes, this may as well be written as `${10 + 2}` (${10 + 2}), but... you know.

## Queries
Space Lua has a feature called [[Space Lua/Lua Integrated Query]], which integrate SQL-like queries into Lua. By using this feature, you can easily replicate [[Live Queries]]. More detail in [[Space Lua/Lua Integrated Query]], but here’s a small example querying the last 3 modifies pages:

${query[[
  from index.tag "page"
  order by lastModified desc
  select name
  limit 3
]]}

## Widgets
The `${lua expression}` syntax can be used to implement simple widgets. If the Lua expression evaluates to a simple string, it will live preview as that string rendered as markdown. However, if the expression returns a Lua table with specific keys, you can do some cooler stuff.

The following keys are supported:

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

Now, let’s use it:
${marquee "Finally, marqeeeeeeee!"}
Oh boy, the times we live in!

## Commands
Custom commands can be defined using [[API/command#command.define(commandDef)]]:

```space-lua
command.define {
  name = "Hello World",
  run = function()
    editor.flashNotification "Hello world!"
    event.dispatch("my-custom-event", {name="Pete"})
  end
}
```

Try it: {[Hello World]}

## Event listeners
You can listen to events using [[API/event#event.listen(listenerDef)]]:

```space-lua
event.listen {
  name = "my-custom-event";
  run = function(e)
    editor.flashNotification("Custom triggered: "
       .. e.data.name)
  end
}
```

# Space Lua Extensions
Space Lua currently introduces a few new features on top core Lua:

1. [[Space Lua/Lua Integrated Query]], embedding a [[Query Language]]-like language into Lua itself
2. Thread locals

## Thread locals
There's a magic `_CTX` global variable available from which you can access useful context-specific values. Currently the following keys are available:

* `_CTX.currentPage` providing access (in the client only) to the currently open page (PageMeta object)
* `_CTX._GLOBAL` providing access to the global scope

# API
![[API]]
While in [[Space Script]] all syscalls are asynchronous and need to be called with `await`, this is happens transparently in Space Lua leading to cleaner code:

```space-lua
local function callSomeThings()
  local text = space.readPage(editor.getCurrentPage())
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
