---
description: A Lua-embedded query syntax for selecting and transforming objects.
tags: glossary
---
Lua Integrated Query (LIQ) is a SilverBullet specific Lua extension. It adds a convenient query syntax to the language in a backwards compatible way. It does so by overloading Lua’s default function call + single argument syntax when using `query` as the function call. As a result, Lua programs using LIQ are still syntactically valid Lua.

The syntax for LIQ is `query[[my query]]`. In regular Lua `[[my query]]` is just another way of writing `"my query"` (it is an alternative string syntax). Function calls that only take a string argument can omit parentheses, therefore `query[[my query]]` is equivalent to `query("my query")`.

However, in [[Space Lua]] it is interpreted as an SQL (and [LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/))-inspired integrated query language.

General syntax:

    query [[
      from <expression>
      where <expression>
      group by <expression>[, ...]
      having <expression>
      order by <expression>
        [asc | desc | using <comparator>]
        [nulls { first | last }]
        [, ...]
      limit <expression>[, ...]
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

## `from`
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

## `where`
The `where` clause allows you to filter data. When the expression evaluated to a truthy value, the item is included in the result.

Example:

${query[[from n = {1, 2, 3, 4, 5} where n > 2]]}

Or to select 5 pages tagged with `#meta`:

${query[[from p = index.tag "page" where table.includes(p.tags, "meta") limit 5]]}

Or select based on name (including folder) and a [[API/string|string function]]:

${query[[from p = index.tag "page" where p.name:startsWith("Person")]]}

## `group by`
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

## `having`
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

## `order by`
The `order by` clause sorts results by one or more expressions. By default, sorting is ascending. Append `desc` for descending order, or `asc` to be explicit about ascending.

As an example, the last 3 modified pages:

${query[[
  from p = index.tag "page"
  order by p.lastModified desc
  select p.name
  limit 3
]]}

You can sort by multiple expressions separated by commas. Each key is evaluated left to right — the second key only matters when the first compares as equal:

${query[[
  from p = index.tag "page"
  order by p.lastModified desc, p.name
  select p.name
  limit 3
]]}

Each sort key can have its own direction:

```lua
query[[
  from p = data
  order by p.category asc, p.priority desc
  select { name = p.name }
]]
```

### Null placement
By default, `nil` values follow SQL conventions: they appear **last** for ascending order and **first** for descending order. You can override this per key with `nulls first` or `nulls last`:

${query[[
  from p = index.tag "page"
  order by p.priority desc nulls last
  select { name = p.name, priority = p.priority }
  limit 3
]]}

### String collation
Sorting of strings can be adjusted with `queryCollation` in [[^Library/Std/Config]].

### `using` (custom comparators)
The `using` clause specifies a custom comparator function instead of the default `asc`/`desc` ordering. The two are mutually exclusive — `using` defines both the comparison logic and the direction.

The comparator must accept two arguments and return `true` when the first should come strictly before the second. It can be a named function:

```lua
function byLength(a, b)
  return #a < #b
end
```

```lua
query [[
  from p = index.tag "page"
  order by p.name using byLength
  select p.name
  limit 5
]]
```

Or an anonymous function inline. Example:

${query[[
  from n = {5, 1, 3, 2, 4}
  order by n using function(a, b) return a < b end
]]}

The `nulls` clause works with `using`, and each sort key can independently choose `asc`/`desc` or `using`:

```lua
query [[
  from p = data
  order by
    p.category using customCategoryCmp,
    p.priority desc nulls last
  select {
    name = p.name
  }
]]
```

When `using` is specified, it overrides any `queryCollation` configuration for that sort key.

> **note** Note
> `using` is a reserved keyword in Space Lua and cannot be used as a variable name.

#### Strict weak ordering
A comparator must satisfy **strict weak ordering** (SWO) — if comparing A with B returns `true`, then comparing B with A must return `false`. In practice this means using strict comparisons like `<` or `>` and **never** `<=` or `>=`.

The query engine validates this at runtime. If comparing two values in both directions both return `true`, the query fails with a clear error:

${query [[
  from n = {5, 1, 3, 2, 3}
  order by n using function(a, b) return a <= b end
]]}

The query engine uses a *stable merge sort* algorithm with guaranteed performance. Items that compare as equal preserve their original order and an invalid comparator cannot cause an infinite loop or crash — the violation is detected and reported as an error.

## `limit`
The `limit` clause allows you to limit the number of results, optionally with an offset.

Example:

${query[[from {1, 2, 3, 4, 5} limit 3]]}

You can also specify an offset to skip some results:

${query[[from {1, 2, 3, 4, 5} limit 3, 2]]}

## `select`
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

# Rendering the output
To render the output as a template, you can rely on the fact that queries return Lua tables. For example, to apply a template to render every page as a link:

${template.each(query[[
  from p = index.tag "page"
  order by p.lastModified desc
  limit 3
]], templates.pageItem)}

To render pages as links with their full local URL, use `templates.fullPageItem`. For more information on available templates, see [[^Library/Std/Infrastructure/Query Templates]].
