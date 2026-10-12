#maturity/experimental

SilverBullet lets you define _page-only_ variables and functions that `${...}` expressions on that same page can use, turning the page into a type of work sheet (think: spreadsheet or Python notebook).

# Defining values
Assign a value inline to a page variable with `${name = expression}`.

Each name can be assigned with `${name = ...}` only once per page.

# `page-lua` blocks
For functions and longer code, use a `page-lua` fenced code block. Globals it assigns (without `local`) become page variables.

```page-lua
function raise(amount, pct)
  return amount * (1 + pct / 100)
end
```

My raise calculated with `raise`: ${raise(salary, increase)}

# How evaluation works
* Definitions (`page-lua` blocks and `${name = ...}`) run top to bottom, so a definition can use anything defined _above_ it.
* Every other `${...}` sees all of the page's definitions, wherever it appears on the page.
* Values are recalculated when the page is saved (SilverBullet saves automatically shortly after you stop typing), and when anything a definition read changes, such as the results of a query or another page's variables (see [[API/widget#When expressions update]]).
* A transcluded page is evaluated in its own scope. Scopes are never merged with the page that embeds it.

# Building on another page’s values
`pageVars.get("page name")` returns a read-only table of the variables defined on page `page name`:

For instance referencing a variable defined [[Examples/Budget]]: ${pageVars.get("Examples/Budget").marketingBudget - 100}

# Setting values
`pageVars.set(name, value)` changes a value by rewriting its `${name = …}` in the page text, so the page shows and saves the new value and everything that uses it updates. Without a page argument it sets the variable on the page the code is on; pass a page name as the third argument to set another page's.

${widgets.button("Give me a raise", function() pageVars.set("increase", 10) end)}

Only a `${name = …}` holding a plain value (a number, string, `true`, `false` or `nil`) can be set; a formula such as `${total = a + b}`, or a name the page doesn't define that way, is an error. See [[API/pageVars]].

# Examples
## Numeric values
My salary right now: ${salary = 1000} USD.
I'm getting a raise of ${increase = 5}%, so my new salary shall be ${salary * (1 + increase / 100)} USD.

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

