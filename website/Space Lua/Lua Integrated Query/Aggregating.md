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
