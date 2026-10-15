#maturity/experimental

SilverBullet lets you define _page-only_ variables and functions that `${...}` expressions on that same page can use, turning the page into a type of work sheet (think: spreadsheet or Python notebook).

# Defining values
Assign a value inline to a page variable with `${name = expression}`.

Each name can be assigned with `${name = ...}` only once per page, and a `page-lua` block can't reassign it either: the value a cell shows is always the value the page uses.

# `page-lua` blocks
For functions and longer code, use a `page-lua` fenced code block. Globals it assigns (without `local`) become page variables.

```page-lua
function raise(amount, pct)
  return amount * (1 + pct / 100)
end
```

My raise calculated with `raise`: ${raise(salary, increase)}

# How evaluation works
* Like in a spreadsheet, order doesn't matter: a definition (`page-lua` block or `${name = ...}`) can use any other definition on the page, above or below it. `${a = b + 1}` above `${b = 1}` works, and so does a cell calling a function from a block further down. Each definition runs once, when something first needs it.
* A `page-lua` block's variables are known by the globals it assigns at its top level (`name = ...` and `function name() ... end`). A global a block assigns only inside an `if`, a loop or a function is set when the block runs, which happens in page order once nothing needs it earlier.
* Definitions that depend on each other in a loop, such as `${a = b + 1}` and `${b = a + 1}`, are a _circular reference_: each definition in the loop shows an error naming it.
* A cell that uses a failing cell fails too, with an error naming the cell that failed.
* Every other `${...}` runs after all definitions, so it can use any of them, wherever it appears on the page.
* If several blocks assign the same global, reading it runs all of them in page order, so the value is the one the last block assigns.
* Values are recalculated when the page is saved (SilverBullet saves automatically shortly after you stop typing), and when anything a definition read changes, such as the results of a query or another page's variables (see [[API/widget#When expressions update]]).
* A transcluded page is evaluated in its own scope. Scopes are never merged with the page that embeds it.

# Building on another page’s values
`pageVars.get(name, "page name")` returns a variable defined on page `page name`, and `pageVars.all("page name")` all of them as a read-only table.

For instance referencing a variable defined [[Examples/Budget]]: ${pageVars.get("marketingBudget", "Examples/Budget") - 100}

# Setting values
`pageVars.set(name, value)` changes a value by rewriting its `${name = …}` in the page text, so the page shows and saves the new value and everything that uses it updates. Without a page argument it sets the variable on the page the code is on; pass a page name as the third argument to set another page's.

${widgets.button("Give me a raise", function() pageVars.set("increase", 10) end)}

Only a `${name = …}` holding a plain value (a number, string, `true`, `false` or `nil`) or a table literal of plain values (such as `${tags = {"a", "b"}}` or a list of records) can be set; a formula such as `${total = a + b}`, or a name the page doesn't define that way, is an error. See [[API/pageVars]].

# Examples
## Numeric values
My salary right now: ${salary = 1000} USD.
I'm getting a raise of ${increase = 5}%, so my new salary shall be ${salary * (1 + increase / 100)} USD.

## Tables
A cell can hold a table literal, for example a small to-do list that a button adds to:

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

## Queries
Base collection:
${recentPages = query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 5
]]}

And a derived projection:
<!--#lua query[[
  from p = recentPages
  limit 3
  select templates.pageItem(p)
]] -->
* [[Space Lua/Page Lua]]
* [[API/pageVars]]
* [[Space Lua]]
<!--/lua-->

