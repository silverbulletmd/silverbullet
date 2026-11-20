---
description: "SilverBullet’s embedded Lua language for queries, scripts and extensions."
tags: glossary
references:
- client/space_lua.ts
- client/space_lua/*
---
Space Lua is a custom dialect and implementation of the [Lua programming language](https://lua.org/), embedded in SilverBullet. It aims to be a largely complete Lua implementation, but adds a few non-standard features while remaining syntactically compatible with “real” Lua.

In essence, Space Lua adds a few features to SilverBullet’s [[Reference/Markdown]] language:

* [[#Definitions]]: Code written in `space-lua` code blocks on [[Tool Page|tool pages]] is enabled across your entire space.
* [[#Expressions]]: The `${expression}` syntax will [[Live Preview]] to its evaluated value. It is common to use this mechanism to render custom [[API/widget|Widgets]]. With `${name = expression}` it defines a [[#Page variables|page variable]] other expressions on the page can use.

Have a look at [[Space Lua/Conventions]] for best practices around code style.

> **note** Note
> Code fences on these docs pages are examples and don’t run. To use one, put it on a page under `Library/`. Use [[Workbench/Console]] to try a one-off expression.

# Definitions
Space Lua definitions are defined in fenced code blocks with the `space-lua` language, on a [[Tool Page]]: a page under `Library/`. Configuration goes on [[^Library/Config]]. These blocks are active **across your entire space** (hence _Space_ Lua), not just on the page they appear on.

To install a reusable definition, copy this example into a `space-lua` block on a page under `Library/` in your own space:

```space-lua
--- Adds two numbers.
---@param a number First number.
---@param b number Second number.
---@return number sum
function adder(a, b)
  return a + b
end
```

Function documentation uses the LuaLS/EmmyLua `---` convention. Contiguous documentation comments immediately before a function are parsed into structured runtime metadata. Supported annotations are `@param`, `@return`, `@deprecated`, and `@see`. Inspect the result from Lua with [[API/spacelua#spacelua.describe|spacelua.describe]]. Regular `--` comments remain ordinary comments.

Each `space-lua` block has its own local scope. However, following Lua semantics, when functions and variables are not explicitly defined as `local` they will be available globally across your [[Reference/Concepts/Space|space]]. This means that the `adder` function defined, can be called from anywhere in your space.

## Definition loading
`space-lua` blocks only run from tool pages. A block on any other page is shown but never runs, and gets a lint warning. To turn that warning off, add `config.set("lint.inactiveBlocks", false)` to your [[^Library/Config]].

When your client boots, or if you explicitly run the `System: Reload` command, all these scripts are executed in sequence. At boot, the scripts of all tool pages load in one request, without waiting for the index. On a fresh client the index is still being built then, so a script that queries the index when it loads should run that query in an `index:ready` [[Reference/Space Lua/Event|event]] listener as well.

Some configuration has to apply before syncing, indexing or the first render: `config.set` for sync settings, `tag.define` so the first index sees your tags and schemas, action buttons. For that, boot runs a restricted early pass over the **boot blocks**, before the client exists. A block is a boot block when it contains a `-- boot: true` comment line, and every block on [[^Library/Config]] is one automatically. In this pass only configuration calls work, and a statement that fails is skipped. Boot blocks then run again with all the others as described here, so a library page that must configure early can mark its block like this:

```space-lua
-- boot: true
tag.define { name = "book" }
```

It is possible to **control load order** of Space Lua scripts using the special `-- priority: <number>` comment in Space Lua code. For instance:

```space-lua
-- priority: 10
local myCodeHere
```

Scripts run in this order:

1. By priority, highest first. A script without a priority comment counts as priority `0`.
2. Scripts with the same priority run in page name order.
3. Scripts on the same page run top to bottom.

The [[Workbench/Code/Scripts|Space Lua]] section of the [[Workbench/Code|Code]] tab shows the actual order.

This means that the higher the priority, the earlier the script is loaded. That also means that if you want to override previously defined definitions you need to a set a _lower_ priority (or in most cases: simply omit the priority comment).

Here are the conventions used by the [[^Library/Std]] library:

* `priority: 100` for config definitions (schemas)
* `priority: 50` for setting really core and root variables (like `template.*` APIs) that will be used by other scripts
* `priority: 10`: for standard library definitions that may be overriden (by scripts with lower priority)

> **note** Tip
> All your space-lua scripts are loaded on boot, to reload them without reloading the page, simply run the ${widgets.commandButton("System: Reload")} (Ctrl-Alt-r) command.

## Authoring loop
When iterating on a `space-lua` block, follow this loop:

1. **Edit** the script in the editor.
2. **Reload**: run `System: Reload` (Ctrl-Alt-r) to re-execute all `space-lua` definitions without a full page reload (you can reload the browser also if you prefer). Run `Space: Reindex` (via the command palette) if you also need the [[Object Index]] rebuilt with fresh data (e.g. if you use [[API/tag#tag.define(spec)]]).
3. **Check the logs**: a reload completing without a visible error **does not mean your script is healthy**. Lua syntax errors, load-time failures, and runtime exceptions during indexing or widget rendering all surface in the logs, not always as a user-visible reload failure. The [[Workbench]] shows them in its Console tab, and its Scripts tab shows which scripts failed to load and why.
4. **Verify** the behavior in the editor.

## Runaway scripts
A `space-lua` definition (or any other Lua execution: an expression, a widget, a command) is given a small time budget on the browser’s main thread. This only counts time the script is actually **busy computing**: loop iterations, function calls, table access, and the like. It never counts time a script spends **waiting** — on an [[API/editor#editor.prompt|editor.prompt]], a network call, or the [[Object Index]] — however long that wait takes, since the main thread is free to do other things in the meantime.

For `space-lua` definitions and commands, if busy time runs past the budget, SilverBullet offers to **Stop** it, with a **Keep going** option if it’s just doing legitimately heavy work. Meanwhile the rest of the editor stays responsive. If you choose to stop a `space-lua` definition, it is **quarantined**: disabled on every subsequent reload, with a banner naming it and a **Re-enable** button. Editing the script (and reloading) lifts the quarantine automatically, since the quarantine is tied to the script’s exact contents — no separate step needed. Widgets and `${…}` expressions are instead stopped automatically and replaced with a “Lua timeout” message inline.

This budget cannot help with a single stdlib call that never returns on its own (e.g. an enormous `string.rep`), or with memory exhaustion.

# Expressions
One SilverBullet specific [[Reference/Markdown]] [[Markdown/Extensions]] is the `${lua expression}` syntax that you can use in your pages. This syntax will [[Live Preview]] to the evaluation of that Lua expression.

After installing `adder`, put `${adder(10, 2)}` in a page to display `12`. The definition above is inert here. To try an expression without installing anything, open [[Workbench/Console]] and evaluate `10 + 2`.

This mechanism is often used in conjunction with [[Space Lua/Integrated Query]] and [[API/widget|Widgets]].

## Where `${...}` works
* **Anywhere inline Markdown renders:** paragraphs, headings, list items, tasks, quotes, table cells, inside bold/italic/links (the formatting is kept).
* **Not evaluated:** inline code and code blocks, [[Reference/Concepts/Template|template]] pages, and [[Linked Mention|Linked Mentions]] snippets (shown as source). To show `${...}` literally in a link alias, put it in backticks.
* **Results:** text is rendered as Markdown, and `${...}` inside it is evaluated too (up to 8 levels deep). Lists show one item per line, records and query results show as a table, and widgets (also inside table cells) stay interactive.
* **Context:** `_CTX.currentPage` is the page being viewed, `_CTX.sourcePage` the page the expression is written on (they differ inside a transclusion). See [[Space Lua/Thread Locals]].

Because `${...}` expressions are evaluated live, their output only exists inside SilverBullet, the markdown file just holds the source. If you want a page to render correctly *outside* SilverBullet too (on GitHub, in another editor), see [[Baked Sections]]: it writes a `${...}` expression’s rendered output into the page as plain markdown, while keeping it updatable.

## Page variables
#maturity/experimental

A `${...}` can also define a _page variable_ with `${name = expression}`. It shows its value, and any other `${...}` on the same page can use the name. This turns a page into a kind of work sheet (think: spreadsheet or Python notebook).

My salary right now: ${salary = 1000} USD.
I’m getting a raise of ${increase = 5}%, so my new salary shall be ${salary * (1 + increase / 100)} USD.

To define a value without showing it, write `local` in front: `${local name = expression}`. The editor shows its name and formula instead of its value (or its error, if it fails), and the rendered page shows nothing. A local variable is otherwise like any other: the page and [[API/pageVars]] can read it.

How page variables are evaluated:
* Each name can be defined only once per page.
* Like in a spreadsheet, order doesn’t matter: a definition can use any other definition on the page, above or below it. `${a = b + 1}` above `${b = 1}` works. Each definition runs once, when something first needs it.
* Definitions that depend on each other in a loop, such as `${a = b + 1}` and `${b = a + 1}`, are a _circular reference_: each definition in the loop shows an error naming it.
* A definition that uses a failing definition fails too, with an error naming the one that failed.
* Every other `${...}` runs after all definitions, so it can use any of them, wherever it appears on the page.
* Values are recalculated when the page is saved (SilverBullet saves automatically shortly after you stop typing), and when anything a definition read changes, such as the results of a query or another page’s variables (see [[API/widget#When expressions update]]).
* A transcluded page is evaluated in its own scope. Scopes are never merged with the page that embeds it.

### Tables and queries
A definition can hold any value, such as a table or the results of a query:

${recentPages = query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 3
]]}

Other expressions can then build on it: ${#recentPages} pages.

### Other pages’ variables
`pageVars.get(name, "page name")` returns a variable defined on page `page name`, and `pageVars.all("page name")` all of them as a read-only table. For instance, referencing a variable defined on [[Examples/Budget]]: ${pageVars.get("marketingBudget", "Examples/Budget") - 100}

### Setting values
`pageVars.set(name, value)` changes a value by rewriting its `${name = …}` in the page text, so the page shows and saves the new value and everything that uses it updates. Without a page argument it sets the variable on the page the code is on. Pass a page name as the third argument to set another page’s.

Copy this complete Markdown example into a writable page:

```markdown
My salary: ${salary = 1000} USD.
Raise: ${increase = 5}%.
New salary: ${salary * (1 + increase / 100)} USD.

${widgets.button("Give me a raise", function() pageVars.set("increase", 10) end)}
```

The new salary starts at 1050 USD. Clicking the button saves `increase = 10` and displays 1100 USD. This write-back example is inert in the read-only documentation.

A variable can also hold a table literal. Copy this complete Markdown example into a writable page to try a button that adds to it:

```markdown
${todos = {
  {
    title = "Book venue",
    done = true,
  },
}}

Open: ${#query[[from t = todos where not t.done]]} of ${#todos}

${widgets.button("Add task", function()
  local title = editor.prompt("Task?")
  if title then
    table.insert(todos, { title = title, done = false })
    pageVars.set("todos", todos)
  end
end)}
```

Initially it shows “Open: 0 of 1”. Adding an unfinished task saves the updated table in the page and changes the result to “Open: 1 of 2”.

Only a `${name = …}` holding a plain value (a number, string, `true`, `false` or `nil`) or a table literal of plain values can be set. A formula such as `${total = a + b}`, or a name the page doesn’t define, is an error. See [[API/pageVars]].

# Space Lua vs “OG” Lua
Space Lua is a _custom Lua implementation_. It does not use the official [Lua](https://www.lua.org) nor [LuaJIT](https://luajit.org) implementations, nor a WebAssembly build of them. For the reasoning behind that choice — and its trade-offs — see [[ADR/005 Space Lua]].

While the aim is to be 95% (let’s say) compatible with regular Lua, there are a few [[Space Lua/Quirks]] to be aware of.

In addition to quirks, Space introduces a (minimal) set of new features on top core Lua:

1. [[Space Lua/Integrated Query]], embedding a query language into Lua itself
2. [[Space Lua/Thread Locals]]
3. [[#Page variables]]: per-page variables and calculations
