#maturity/experimental

The `group by` and `having` clauses of [[Space Lua/Lua Integrated Query]] support aggregate functions for grouped analysis, following SQL-style semantics.

After `group by`, each result row contains:

- `key`: the group key (a single value or, for multi-key grouping, a table)
- `group`: a Lua table containing all items in that group

All aggregate functions (such as `count`, `sum`, `min`, `max`, `avg`, and custom aggregates) can be applied in `select` and `having` clauses. Aggregate expressions are available in both forms: with or without a variable binding in the `from` clause. The variable `_` always refers to the current item.

Field names used in `group by` are exposed as locals in `having`, `select`, and `order by`. Use `#group` to obtain the item count per group.

> **note** Note
> The `having` clause acts only on grouped output. For filtering individual items, use `where` prior to grouping.

# Examples

All queries operate on `index.tag 'page'`.

## Counting with and without binding

Grouping pages by their first tag, and computing the count and aggregate statistics:

**Without binding variable:**

```lua
query[[from
  index.tag 'page'
group by
  tags[1]
select {
  tag = key,
  total = count(name),
  min_size = min(size),
  max_size = max(size),
  avg_size = avg(size)
}]]
```
${query [[
  from
    index.tag 'page'
  group by
    tags[1]
  select {
    tag = key,
    total = count(name),
    min_size = min(size),
    max_size = max(size),
    avg_size = avg(size)
  }
]]}

**With binding variable:**

```lua
query[[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    total = count(p.name),
    min_size = min(p.size),
    max_size = max(p.size),
    avg_size = avg(p.size)
  }
]]
```
${query [[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    total = count(p.name),
    min_size = min(p.size),
    max_size = max(p.size),
    avg_size = avg(p.size)
  }
]]}

## Multi-key grouping and aggregate

```lua
query[[
  from
    index.tag 'page'
  group by
    tags[1],
    tags[2]
  select {
    first = key[1],
    second = key[2],
    count = count(name)
  }
]]
```
${query [[
  from
    index.tag 'page'
  group by
    tags[1],
    tags[2]
  select {
    first = key[1],
    second = key[2],
    count = count(name)
  }
]]}

## Group filtering with `having` and aggregates

Only groups with more than two items:

```lua
query[[
  from
    index.tag 'page'
  group by
    tags[1]
  having
    count(name) > 2
  select {
    tag = key,
    total = count(name)
  }
]]
```
${query [[
  from
    index.tag 'page'
  group by
    tags[1]
  having
    count(name) > 2
  select {
    tag = key,
    total = count(name)
  }
]]}

## Per-aggregate filtering with `filter(where ...)`

Individual aggregate expressions can include a `filter(where <condition>)` clause to restrict which rows contribute to that specific aggregate.

Unlike `where` (which filters rows before grouping) and `having` (which filters entire groups after aggregation), `filter(where ...)` applies per-aggregate, per-row within each group. Multiple aggregates in the same `select` can each have different filters.

```lua
query[[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    total = count(p.name),
    big = count(p.name) filter(where p.size > 10),
    big_sz = sum(p.size) filter(where p.size > 10)
  }
  order by
    tag
]]
```
${query [[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    total = count(p.name),
    big = count(p.name) filter(where p.size > 10),
    big_sz = sum(p.size) filter(where p.size > 10)
  }
  order by
    tag
]]}

The filter clause works with all aggregate functions: `count`, `sum`, `min`, `max`, `avg`, `array_agg`, and custom aggregates.  When no rows match the filter condition, aggregates return their identity value: `0` for `count` and `sum`, `nil` for `min`, `max`, and `avg`, and an empty table `{}` for `array_agg`.

## Field access after grouping

Non-aggregated field references, such as `name` in `select`, refer to the first item in the group, matching common SQL and MySQL semantics.

```lua
query[[
  from
    index.tag 'page'
  group by
    tags[1]
  select {
    tag = key,
    first_page = name,
    n = count(name)
  }
]]
```
${query [[
  from
    index.tag 'page'
  group by
    tags[1]
  select {
    tag = key,
    first_page = name,
    n = count(name)
  }
]]}

## Custom aggregators

Custom aggregator functions may be defined by the user using [[Library/Std/APIs/Aggregate|dedicated API]].

# See also

- [[Space Lua/Lua Integrated Query/Grouping]] — grouping queries without aggregation
- [[Space Lua/Lua Integrated Query]] — full LIQ language reference and listing available aggregators
