#maturity/experimental

Page Lua lets a page define its own variables and functions that `${...}` expressions on that page can use, turning the page into a type of work sheet.

# Defining values
Assign a value inline with `${name = expression}`.

My salary right now: ${salary = 500}
I'm getting a raise of ${increase = 5}%, so my new salary shall be ${salary * (1 + increase / 100)}.

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
* Values are recalculated when the page is saved (SilverBullet saves automatically shortly after you stop typing).
* A transcluded page is evaluated in its own scope. Scopes are never merged with the page that embeds it.

# Building on another page’s values
`space.pageVars("page name")` returns a read-only table of the variables defined on page `page name`:

For instance referencing a variable defined [[Examples/Budget]]: ${space.pageVars("Examples/Budget").marketingBudget - 100}
