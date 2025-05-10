Space Lua is a custom dialect and implementation of the [Lua programming language](https://lua.org/), embedded in SilverBullet. It aims to be a largely complete Lua implementation, but adds a few non-standard features while remaining syntactically compatible with “real” Lua.

# Basics
In its essence, Space Lua adds two features to SilverBullet’s [[Markdown]] language:

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

Each `space-lua` block has its own local scope. However, following Lua semantics, when functions and variables are not explicitly defined as `local` they will be available globally across your [[Spaces|space]]. This means that the `adder` function above can be used in any other page.

Since there is a single global namespace, it is good practice to manually namespace functions using the following pattern:

```space-lua
-- This initializes the stuff variable with an empty table if it's not already defined
stuff = stuff or {}

function stuff.adder(a, b)
  return a + b
end
```

## Load order
It is possible to control load order of space lua scripts using the special `-- priority: <number>` comment in Lua code.

Scripts are loaded in _reverse priority_ order. When you set no priority (the default) your scripts will be run last.

The order used is determined by this [[Space Lua/Lua Integrated Query|query]] (also part of your [[^Library/Std/Space Overview]]) page: 

    query[[
      from index.tag "space-lua"
      order by priority desc
    ]]

This means that the higher the priority, the earlier the script is loaded. That also means that if you want to override previously defined definitions you need to a set a _lower_ priority (or in most cases: simply omit the priority comment).

Here are the conventions used by the [[Library/Std]] library:

  * `priority: 100` for config definitions (schemas)
  * `priority: 50` for setting really core and root variables (like `template.*` APIs) that will be used by other scripts
  * `priority: 10`: for standard library definitions that may be overriden (by scripts with lower priority)

> **note** Tip
> All your space-lua scripts are loaded on boot, to reload them without reloading the page, simply run the ${widgets.commandButton("System: Reload")} (Ctrl-Alt-r) command.

# Expressions
A new syntax introduced with Space Lua is the `${lua expression}` syntax that you can use in your pages. This syntax will [[Live Preview]] to the evaluation of that expression.

For example: 10 + 2 = ${adder(10, 2)} (Alt-click, or select to see the expression) is using the just defined `adder` function to this rather impressive calculation.

Note that you can have the text {lua expression} in your page and it won't be evaluated. So writing `${"$"}{lua expression}` can be used to “delay” evaluation by one pass, for example to escape expressions in templated content.

## Queries
Space Lua has a feature called [[Space Lua/Lua Integrated Query]], which integrate SQL-like queries into Lua. Here’s a small example querying the last 3 modifies pages:

${query[[
  from index.tag "page"
  order by lastModified desc
  select name
  limit 3
]]}

[[Space Lua/Widgets]]

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

Try it: ${widgets.commandButton("Hello World")}

## Slash commands
Custom slash commands can be defined using [[API/slashcommand#slashcommand.define(spec)]]:

```space-lua
slashcommand.define {
  name = "hello",
  run = function()
editor.insertAtCursor("Hello |^| world!", false, true)
  end
}
```

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
Space Lua introduces a few new features on top core Lua:

1. [[Space Lua/Lua Integrated Query]], embedding a query language into Lua itself
2. Thread locals

## Thread locals
There's a magic `_CTX` global variable available from which you can access useful context-specific values. Currently the following keys are available:

* `_CTX.currentPage` providing access (in the client only) to the currently open page (PageMeta object)
* `_CTX._GLOBAL` providing access to the global scope

# API
![[API]]

# Lua implementation notes
Space Lua is intended to be a more or less complete implementation of [Lua 5.4](https://www.lua.org/manual/5.4/). However, a few features are (still) missing:

* `goto` and labels (not planned, goto considered harmful)
* coroutines (not planned, not useful in the SilverBullet context)
* _ENV (planned)
* Full metatable support (only partial now, planned)
* Hexadecimal numeric constants with a fractional part, or binary exponents (not supported by JavaScript number parser either)

# Frequently Asked Questions
## Why Lua?
Lua is purpose-designed to be a simple, [easy to learn](https://www.lua.org/manual/5.4/), yet powerful language for extending existing applications. It is commonly used in the gaming industry, but to extend many other applications. If you know any other programming language, you will be able to learn Lua within hours or less.

## Why a custom Lua runtime?
Rather than using a WebAssembly or other implementation of Lua that could run in the browser and server, we have opted for a custom implementation. This is achievable because Lua is a relatively simple and small language to implement and allows for deep integration in the custom Lua runtime. The thing that triggered a custom implementation was the need to call asynchronous (JavaScipt) APIs from Lua, without having to resort to ugly asynchronous callback-style API design (Lua does not support async-await). In SilverBullet’s Lua implementation, the differences between asynchronous and synchronous APIs is fully abstracted away, which makes for a very clean development experience.
