Lua Integrated Query (LIQ) is a SilverBullet specific Lua extension. It adds a convenient query syntax to the language in a backwards compatible way. It does so by overloading Lua’s default function call + single argument syntax when using `query` as the function call. As a result, Lua programs using LIQ are still syntactically valid Lua.

The syntax for LIQ is `query[[my query]]`. In regular Lua `[[my query]]` is just another way of writing `"my query"` (it is an alternative string syntax). Function calls that only take a string argument can omit parentheses, therefore `query[[my query]]` is equivalent to `query("my query")`.

However, in [[Space Lua]] it is interpreted as an SQL (and [LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/))-inspired integrated query language.

General syntax:

    query[[
      from <var> in <expression>
      where <expression>
      group by <expression>[, <expression>, ...]
      having <expression>
      order by <expression>
      limit <expression>, <expression>
      select <expression>
    ]]

LIQ operates on any Lua collection.

For instance, to sort a list of numbers in descending order:
${query[[from n = {1, 2, 3} order by n desc]]}

However, in most cases you’ll use it in conjunction with [[API/index#index.tag(name)]]. Here’s an example querying the 3 pages that were last modified:

${query[[
  from p = index.tag "page"
  order by p.lastModified desc
  select p.name
  limit 3
]]}

Note that the query returns a regular Lua table, so it can be part of a bigger expression:

${some(query[[
  from p = index.tag "page"
  limit 0
]]) or "Matched no pages"}

# Clauses
Here are the clauses that are currently supported:

## from <expression>
The `from` clause specifies the source of your data. There are two syntactic variants:

**Recommended:** With explicit variable binding:

    from v = <<expression>>

binding each item to the variable `v`.

However, there is also the more concise:

    from <<expression>>

implicitly binding each item to the variable `_` as well as making all attributes directly available as variables. The latter, while shorter, is less performant and will block future optimizations, so the variable-binding variant is preferred.

> **warning** Warning
> When you use a `from` clause without explicit variable binding (so without the `v in` syntax), note that any attribute of the object you’re iterating over will shadow global variables. For instance, if you have an object with a `table` attribute, regular `table` APIs will become inaccessible within the query.
>
> **Recommendation:** Use the explicit variable binding syntax

Example without variable binding:
${query[[from {1, 2, 3} select _]]}

With variable binding:
${query[[from n = {1, 2, 3} select n]]}

A more realistic example using `index.tag`:
${query[[from p = index.tag "page" order by p.lastModified select p.name limit 3]]}

## where <expression>
The `where` clause allows you to filter data. When the expression evaluated to a truthy value, the item is included in the result.

Example:

${query[[from n = {1, 2, 3, 4, 5} where n > 2]]}

Or to select 5 pages tagged with `#meta`:

${query[[from p = index.tag "page" where table.includes(p.tags, "meta") limit 5]]}

Or select based on name (including folder) and a [[API/string|string function]]:

${query[[from p = index.tag "page" where p.name:startsWith("Person")]]}

## group by <expression>[, <expression>, ...]
The `group by` clause groups results by one or more key expressions. After grouping, each result row becomes a table with two fields:

- `key` — the group key value (single value for one key, table for multi-key)
- `group` — a table (array) of all original items in that group

The `group by` field names are also available as bare variables in `having`, `select`, and `order by`. Use `#group` to get the count of items in a group.

Example:

${query[[
  from p = index.tag "tag"
  group by p.name
  select { name = name, count = #group }
  limit 5
]]}

See [[Space Lua/Lua Integrated Query/Grouping]] for detailed examples.

## having <expression>
The `having` clause filters groups **after** `group by`. It follows SQL semantics: only group key fields, `key`, and `group` are accessible — use `where` to filter individual rows before grouping.

Aggregate functions like `count()`, `sum()`, `min()`, `max()`, and `avg()` can be used in `having` expressions. See [[Space Lua/Lua Integrated Query/Aggregating]] for details.

Example:

${query[[
  from p = index.tag "tag"
  group by p.name
  having #group > 2
  select { name = name, count = #group }
  order by count desc
  limit 5
]]}

See [[Space Lua/Lua Integrated Query/Grouping]] for detailed examples.

## order by <expression> [desc]
The `order by` clause allows you to sort data, when `desc` is specified it reverts the sort order.

As an example, the last 3 modified pages:
${query[[
  from p = index.tag "page"
  order by p.lastModified desc
  select p.name
  limit 3
]]}

You can order based on multiple expressions by specifying multiple expressions separated by commas:

${query[[
  from p = index.tag "page"
  order by p.lastModified desc, p.name
  select p.name
  limit 3
]]}

Sorting of strings can be adjusted with `queryCollation` in [[^Library/Std/Config]]

## limit <expression>[, <expression>]
The `limit` clause allows you to limit the number of results, optionally with an offset.

Example:

${query[[from {1, 2, 3, 4, 5} limit 3]]}

You can also specify an offset to skip some results:

${query[[from {1, 2, 3, 4, 5} limit 3, 2]]}

## select <expression>
The `select` clause allows you to transform each item in the result set. If omitted, it defaults to returning the item itself.

When used with `group by`, aggregate functions like `sum()`, `count()`, `min()`, `max()`, and `avg()` can be used in the `select` expression to compute values across each group. See [[Space Lua/Lua Integrated Query/Aggregating]] for details.

Some examples:

Double each number:
${query[[from n = {1, 2, 3} select n * 2]]}

It is convenient to combine it with the [[API/table#table.select(table, keys...)]] API:
${query[[
  from p = index.tag "page"
  select table.select(p, "name", "lastModified")
  limit 3
]]}

# Listing available aggregate functions

You can list all available aggregator functions (built-ins and custom) using LIQ.

Example:

${query [[
  from k, v in pairs(config.get("aggregates", {}))
  select { name = k, desc = v.description }
  order by name
]]}

# Rendering the output
To render the output as a template, you can rely on the fact that queries return Lua tables. For example, to apply a template to render every page as a link:

${template.each(query[[
  from p = index.tag "page"
  order by p.lastModified desc
  limit 3
]], templates.pageItem)}

To render pages as links with their full local URL, use `templates.fullPageItem`. For more information on available templates, see [[^Library/Std/Infrastructure/Query Templates]].
