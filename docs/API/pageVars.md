---
tags: api/space-lua maturity/experimental
---
APIs to read and set [[Space Lua/Page Lua|page variables]]: the values a page defines with `${name = …}` and `page-lua` blocks.

Both functions take an optional page name as their last argument. Without it they use the page the running code is on: the page a `${…}`, code widget or button belongs to (for a button inside a transclusion, the transcluded page), or else the open page.

Example: ${counter = 1}
Counter * pi: ${math.pi * counter}

${widgets.button("Add one", function()
  pageVars.set("counter", counter + 1)
end)}

# API
## pageVars.get(page?)
Returns a read-only table of a page's variables.

```lua
pageVars.get("Budget").salary
pageVars.get().rate
```

An expression that reads a page’s variables updates when they change. Reading a page whose definitions fail is an error naming the first failing definition, and a chain of pages that read each other is reported as a cycle.

## pageVars.set(name, value, page?)
Sets a variable by rewriting its `${name = …}` in the page text, so the page shows and saves the new value and everything that uses it updates.

```lua
pageVars.set("rate", 0.2)
pageVars.set("salary", 600, "Budget")
```

* `value` must be a number, string, boolean or `nil`.
* The page must define `name` with exactly one `${name = …}` holding a plain value. A formula such as `${total = a + b}`, a variable assigned only in a `page-lua` block, or a name the page doesn't define is an error.
* On the open page, the change is a single undoable edit and the page is saved right away.
* Setting a variable to the value it already has changes nothing.
* A read-only space, or a read-only target page, is an error.
