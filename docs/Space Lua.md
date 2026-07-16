---
description: "SilverBullet's embedded Lua scripting environment for extending functionality."
tags: glossary
references:
- client/space_lua.ts
- client/space_lua/*
---
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
--- Adds two numbers.
---@param a number First number.
---@param b number Second number.
---@return number sum
function adder(a, b)
  return a + b
end
```

Function documentation uses the LuaLS/EmmyLua `---` convention. Contiguous documentation comments immediately before a function are parsed into structured runtime metadata. Supported annotations are `@param`, `@return`, `@deprecated`, and `@see`; inspect the result from Lua with [[API/spacelua#spacelua.describe|spacelua.describe]]. Regular `--` comments remain ordinary comments.

Each `space-lua` block has its own local scope. However, following Lua semantics, when functions and variables are not explicitly defined as `local` they will be available globally across your [[Space|space]]. This means that the `adder` function defined, can be called from anywhere in your space.

## Definition loading
Your `space-lua` definitions are constantly being indexed as part of the [[Object Index]] with the [[Object/space-lua]] tag. There is nothing you have to do for this, other than be a bit patient for things to start working when you initialize a fresh client.

When your client boots, or if you explicitly run the `System: Reload` command, all these scripts are executed in sequence. 

It is possible to **control load order** of Space Lua scripts using the special `-- priority: <number>` comment in Space Lua code. For instance:

```space-lua
-- priority: 10
local myCodeHere
```

Scripts are loaded in _reverse priority_ order. When you set no priority (the default) your scripts will be run last.

The order used is determined by this [[Space Lua/Integrated Query|query]] (also part of your [[^Library/Std/Pages/Space Overview]]) page:

    query[[
      from t = index.objects("space-lua")
      order by t.priority desc
    ]]

This means that the higher the priority, the earlier the script is loaded. That also means that if you want to override previously defined definitions you need to a set a _lower_ priority (or in most cases: simply omit the priority comment).

Here are the conventions used by the [[Library/Std]] library:

* `priority: 100` for config definitions (schemas)
* `priority: 50` for setting really core and root variables (like `template.*` APIs) that will be used by other scripts
* `priority: 10`: for standard library definitions that may be overriden (by scripts with lower priority)

> **note** Tip
> All your space-lua scripts are loaded on boot, to reload them without reloading the page, simply run the ${widgets.commandButton("System: Reload")} (Ctrl-Alt-r) command.

## Authoring loop
When iterating on a `space-lua` block, follow this loop:

1. **Edit** the script in the editor.
2. **Reload**: run `System: Reload` (Ctrl-Alt-r) to re-execute all `space-lua` definitions without a full page reload (you can reload the browser also if you prefer). Run `Space: Reindex` (via the command palette) if you also need the [[Object Index]] rebuilt with fresh data (e.g. if you use [[API/tag#tag.define(spec)]]).
3. **Check the brower’s logs**: a reload completing without a visible error **does not mean your script is healthy**. Lua syntax errors, load-time failures, and runtime exceptions during indexing or widget rendering all surface in the browser console logs, not always as a user-visible reload failure.
4. **Verify** the behaviour in the editor.

> **note** Note
> Lua examples in the docs use `lua` fenced blocks (not `space-lua`) so they are not activated on the docs site itself; when using snippets in your own space, change `lua` to `space-lua`. See the note at the top of this page.

# Expressions
One SilverBullet specific [[Markdown]] [[Markdown/Extensions]] is the `${lua expression}` syntax that you can use in your pages. This syntax will [[Live Preview]] to the evaluation of that Lua expression.

For example: 10 + 2 = ${adder(10, 2)} (Alt-click, or select to see the expression) is using the just defined `adder` function.

This mechanism is often used in conjunction with [[Space Lua/Integrated Query]] and [[API/widget|Widgets]].

Because `${...}` expressions are evaluated live, their output only exists inside SilverBullet, the markdown file just holds the source. If you want a page to render correctly *outside* SilverBullet too (on GitHub, in another editor), see [[Baked Sections]]: it writes a `${...}` expression’s rendered output into the page as plain markdown, while keeping it updatable.

# API
![[API]]
# Space Lua vs “OG” Lua
Space Lua is a _custom Lua implementation_. It does not use the official [Lua](https://www.lua.org) nor [LuaJIT](https://luajit.org) implementations, nor a WebAssembly build of them. For the reasoning behind that choice — and its trade-offs — see [[ADR/005 Space Lua]].

While the aim is to be 95% (let’s say) compatible with regular Lua, there are a few [[Space Lua/Quirks]] to be aware of.

In addition to quirks, Space introduces a (minimal) set of new features on top core Lua:

1. [[Space Lua/Integrated Query]], embedding a query language into Lua itself
2. [[Space Lua/Thread Locals]]
