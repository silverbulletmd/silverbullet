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
All example queries operate on `tags.page`, but will work with any query collection. As always, to see the underlying query, hover over the result table and click the _Edit_ button to see the underlying query.

## Counting with and without binding
Grouping pages by their first tag, and computing the count and aggregate statistics:

**Without binding variable**
${query [[
  from
    tags.page
  group by
    tags[1]
  select {
    tag = key,
    total = count(name),
    min_size = min(size),
    max_size = max(size),
    avg_size = avg(size)
  }
  order by total desc
]]}

**With binding variable**
${query [[
  from
    p = tags.page
  group by
    p.tags[1]
  select {
    tag = key,
    total = count(p.name),
    min_size = min(p.size),
    max_size = max(p.size),
    avg_size = avg(p.size)
  }
  order by total desc
]]}

## Multi-key grouping and aggregate
${query[[
  from
    p = tags.page
  group by
    p.tags[1],
    p.tags[2]
  select {
    first = key[1],
    second = key[2],
    count = count(p.name)
  }
]]}

## Group filtering with `having` and aggregates
Only groups with more than two items and at least one tag set:
${query[[
  from
    p = tags.page
  group by
    p.tags[1]
  having
    count(p.name) > 2 and key
  select {
    tag = key,
    total = count(p.name)
  }
]]}

## Per-aggregate filtering with `filter(where ...)`
Individual aggregate expressions can include a `filter(where <condition>)` clause to restrict which rows contribute to that specific aggregate.

Unlike `where` (which filters rows before grouping) and `having` (which filters entire groups after aggregation), `filter(where ...)` applies per-aggregate, per-row within each group. Multiple aggregates in the same `select` can each have different filters.

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

${query [[
  from
    p = tags.page
  group by
    p.tags[1]
  select {
    tag = key,
    first_page = p.name,
    n = count(p.name)
  }
]]}

## Custom aggregators
Custom aggregator functions may be defined by the user using [[Library/Std/APIs/Aggregate|dedicated API]].

# See also
* [[Space Lua/Lua Integrated Query/Grouping]] — grouping queries without aggregation
* [[Space Lua/Lua Integrated Query]] — full LIQ language reference and listing available aggregators
