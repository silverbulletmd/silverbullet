---
tags: api/space-lua maturity/experimental
---
APIs to read and set [[Space Lua/Page Lua|page variables]]: the values a page defines with `${name = …}` and `page-lua` blocks.

Each function takes an optional page name as its last argument. Without it they use the page the running code is on: the page a `${…}`, code widget or button belongs to (for a button inside a transclusion, the transcluded page), or else the open page.

Copy this complete Markdown example into a writable page. The button saves the incremented value back to that page. It is shown as source here because the published documentation is read-only.

```markdown
Example: ${counter = 1}
Counter * pi: ${math.pi * counter}

${widgets.button("Add one", function()
  pageVars.set("counter", counter + 1)
end)}
```

Initially the counter is 1. After one click it is 2, and the multiplication result updates.

# API
## pageVars.get(name, page?)
Returns one of a page’s variables. A name the page doesn’t define is an error. A variable holding `nil` returns `nil`.

```space-lua
pageVars.get("salary", "Budget")
pageVars.get("rate")
```

## pageVars.all(page?)
Returns a read-only table of all of a page’s variables, which you can print or iterate.

```space-lua
pageVars.all("Budget")
for name, value in pairs(pageVars.all()) do print(name, value) end
```

An expression that reads a page’s variables updates when they change. Reading a page whose definitions fail is an error naming the first failing definition, and a chain of pages that read each other is reported as a cycle.

## pageVars.set(name, value, page?)
Sets a variable by rewriting its `${name = …}` in the page text, so the page shows and saves the new value and everything that uses it updates.

```space-lua
pageVars.set("rate", 0.2)
pageVars.set("salary", 600, "Budget")
```

* `value` must be a number, string, boolean, `nil`, or a table of these (tables may nest). A function, a table with a metatable, or a table that contains itself is an error.
* The page must define `name` with exactly one `${name = …}` holding a plain value or a table literal of plain values. A formula such as `${total = a + b}`, a variable assigned only in a `page-lua` block, or a name the page doesn’t define is an error.
* On the open page, the change is a single undoable edit and the page is saved right away.
* A read-only space, or a read-only target page, is an error.
