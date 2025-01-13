Lua Integrated Query (LIQ) is a SilverBullet specific Lua extension. It adds a convenient query syntax to the language in a backwards compatible way. It does so by overloading Lua’s default function call + single argument syntax when using `query` as the function call. As a result, Lua programs using LIQ are still syntactically valid Lua.

The syntax for LIQ is `query[[my query]]`. In regular Lua `[[my query]]` is just another way of writing `"my query"` (it is an alternative string syntax). Function calls that only take a string argument can omit parentheses, therefore `query[[my query]]` is equivalent to `query("my query")`.

However, in [[Space Lua]] it interpreted as an SQL (and [LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/))-inspired integrated query language. 

General syntax:

    query[[
      from <var> = <expression>
      where <expression>
      order by <expression>
      limit <expression>, <expression>
      select <expression>
    ]]

Unlike [[Query Language]] which operates on [[Objects]] only, LIQ can operate on any Lua collection.

For instance, to sort a list of numbers in descending order:
${query[[from n = {1, 2, 3} order by n desc]]}

However, in most cases you’ll use it in conjunction with [[Space Lua/stdlib#tag(name)]]. Here’s an example querying the 3 pages that were last modified:

${query[[
  from p = tag "page"
  order by p.lastModified desc
  select p.name
  limit 3
]]}

# Clauses
Here are the clauses that are currently supported:

## `from <expression>`
The `from` clause specifies the source of your data. There are two syntactic variants:

With explicit variable binding:

    from v = <<expression>>

binding each item to the variable `v`.

And the shorter:

    from <<expression>>

implicitly binding each item to the variable `_` as well as making all attributes directly available as variables.

Example without variable binding:
${query[[from {1, 2, 3} select _]]}

With variable binding:
${query[[from n = {1, 2, 3} select n]]}

A more realistic example using `tag`:
${query[[from tag "page" order by lastModified select name limit 3]]}

## `where <expression>`
The `where` clause allows you to filter data. When the expression evaluated to a truthy value, the item is included in the result.

Example:

${query[[from {1, 2, 3, 4, 5} where _ > 2]]}

Or to select all pages tagged with `#meta`:

${query[[from tag "page" where table.includes(tags, "meta")]]}

## `order by <expression> [desc]`
The `order by` clause allows you to sort data, when `desc` is specified it reverts the sort order.

As an example, the last 3 modified pages:
${query[[
  from tag "page"
  order by lastModified desc
  select name
  limit 3
]]}

## `limit <expression>[, <expression>]`
The `limit` clause allows you to limit the number of results, optionally with an offset.

Example:

${query[[from {1, 2, 3, 4, 5} limit 3]]}

You can also specify an offset to skip some results:

${query[[from {1, 2, 3, 4, 5} limit 3, 2]]}

## `select <expression>`
The `select` clause allows you to transform each item in the result set. If omitted, it defaults to returning the item itself.

Some examples:

Double each number:
${query[[from {1, 2, 3} select _ * 2]]}

Extract just the name from pages:
${query[[from tag "page" select _.name limit 3]]}

You can also return tables or other complex values:
${query[[
  from p = tag "page" 
  select {
    name = p.name,
    modified = p.lastModified
  }
  limit 3
]]}
