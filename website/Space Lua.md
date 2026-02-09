Space Lua is a custom dialect and implementation of the [Lua programming language](https://lua.org/), embedded in SilverBullet. It aims to be a largely complete Lua implementation, but adds a few non-standard features while remaining syntactically compatible with “real” Lua.

In its essence, Space Lua adds two features to SilverBullet’s [[Markdown]] language:

* [[#Definitions]]: Code written in `space-lua` code blocks are enabled across your entire space.
* [[#Expressions]]: The `${expression}` syntax will [[Live Preview]] to its evaluated value. It is common to use this mechanism to render custom [[API/widget|Widgets]].

Have a look at [[Space Lua/Conventions]] for best practices around code style.

> **note** Note
> Many examples in the documentation use `lua` as a [[Markdown/Fenced Code Block]] language rather than `space-lua`, this is to be able to give example of Space Lua code without actually “activating” it as such on the website. When you use these snippets yourself, replace `lua` with `space-lua`.

# Definitions
Space Lua definitions are defined in fenced code blocks with the `space-lua` language. These blocks are active **across your entire space** (hence _Space_ Lua), not just on the page they appear on.

A simple example:

```space-lua
-- adds two numbers
function adder(a, b)
  return a + b
end
```

Each `space-lua` block has its own local scope. However, following Lua semantics, when functions and variables are not explicitly defined as `local` they will be available globally across your [[Space|space]]. This means that the `adder` function defined, can be called from anywhere in your space.

## Definition loading
Your `space-lua` definitions are constantly being indexed as part of the [[Object Index]] with the [[Object/space-lua]] tag. There is nothing you have to do for this, other than be a bit patient for things to start working when you initialize a fresh client.

When your client boots, or if you explicitly run the `System: Reload` command, all these scripts are executed in sequence. 

It is possible to **control load order** of space lua scripts using the special `-- priority: <number>` comment in Space Lua code. For instance:

```space-lua
-- priority: 10
local myCodeHere
```

Scripts are loaded in _reverse priority_ order. When you set no priority (the default) your scripts will be run last.

The order used is determined by this [[Space Lua/Lua Integrated Query|query]] (also part of your [[^Library/Std/Pages/Space Overview]]) page:

    query[[
      from t = index.tag "space-lua"
      order by t.priority desc
    ]]

This means that the higher the priority, the earlier the script is loaded. That also means that if you want to override previously defined definitions you need to a set a _lower_ priority (or in most cases: simply omit the priority comment).

Here are the conventions used by the [[Library/Std]] library:

* `priority: 100` for config definitions (schemas)
* `priority: 50` for setting really core and root variables (like `template.*` APIs) that will be used by other scripts
* `priority: 10`: for standard library definitions that may be overriden (by scripts with lower priority)

> **note** Tip
> All your space-lua scripts are loaded on boot, to reload them without reloading the page, simply run the ${widgets.commandButton("System: Reload")} (Ctrl-Alt-r) command.

# Expressions
One SilverBullet specific [[Markdown]] [[Markdown/Extensions]] is the `${lua expression}` syntax that you can use in your pages. This syntax will [[Live Preview]] to the evaluation of that Lua expression.

For example: 10 + 2 = ${adder(10, 2)} (Alt-click, or select to see the expression) is using the just defined `adder` function.

This mechanism is often used in conjunction with [[Space Lua/Lua Integrated Query]] and [[API/widget|Widgets]].

# API
![[API]]
# Space Lua vs “OG” Lua
Space Lua is a _custom Lua implementation_. It does not use the official [Lua](https://www.lua.org) nor [LuaJIT](https://luajit.org) implementations. Rather than using a WebAssembly or other implementation of Lua that could run in the browser, we have opted for a custom implementation. There are various (partially historical) reasons for this decision, but taking this path has given us a very smooth interoperability story allowing for very friction-free access to a lot of SilverBullet and browser functionality. It also enables relatively deep integration into the Lua runtime, enabling features like (some) code complete support, (some) jump to definition and various other features.

While the aim is to be 95% (let’s say) compatible with regular Lua, there are a few [[Space Lua/Quirks]] to be aware of.

In addition to quirks, Space introduces a (minimal) set of new features on top core Lua:

1. [[Space Lua/Lua Integrated Query]], embedding a query language into Lua itself
2. [[Space Lua/Thread Locals]]