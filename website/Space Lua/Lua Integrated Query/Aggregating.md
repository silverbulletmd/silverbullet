#maturity/experimental

The `group by` and `having` clauses of [[Space Lua/Lua Integrated Query]] support aggregate functions for grouped analysis, following SQL-style semantics.

After `group by`, each result row contains:

- `key`: the group key (a single value or, for multi-key grouping, a table)
- `group`: a Lua table containing all items in that group

All aggregate functions (such as `count`, `sum`, `min`, `max`, `avg`, and custom aggregates) can be applied in `select` and `having` clauses. Aggregate expressions are available in both forms: with or without a variable binding in the `from` clause. The variable `_` always refers to the current item.

Field names used in `group by` are exposed as locals in `having`, `select`, and `order by`. Use `#group` to obtain the item count per group.

> **note** Note
> The `having` clause acts only on grouped output. For filtering individual items, use `where` prior to grouping.

# Available aggregates

All registered aggregate functions — built-in, user-defined, and aliases — can be listed via `index.aggregates()`:

${query[[from index.aggregates() order by name]]}

See [[Library/Std/APIs/Aggregate|Aggregate API]] for how to define custom aggregates and aliases.

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

The filter clause works with all aggregate functions: `count`, `sum`, `min`, `max`, `avg`, `array_agg`, and custom aggregates.  When no rows match the filter condition, aggregates return their empty-group value: `0` for `count`, `nil` for `sum`, `min`, `max`, and `avg`, and an empty table `{}` for `array_agg`.

## Intra-aggregate `order by`
Aggregate functions can include an `order by` clause **inside** the function call to control the order in which values are processed.

For commutative aggregates like `sum`, `count`, `min`, `max`, and `avg`, the intra-aggregate `order by` has no effect on the result because the value is the same regardless of iteration order. It is only meaningful for order-dependent aggregates like `array_agg`.

Ordered-set aggregates such as `quantile`, `percentile_cont`, and `percentile_disc` require an intra-aggregate `order by` clause to produce correct results, as they depend on the iteration order of input values. Without `order by`, results are undefined.

### Basic example

Collect page names sorted alphabetically within each group:

${query [[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    names_asc  = array_agg(p.name order by p.name asc),
    names_desc = array_agg(p.name order by p.name desc)
  }
  order by
    tag
  limit
    5
]]}

### Combined with `filter(where ...)`
The `order by` and `filter` clauses can be used together. The filter is applied first (excluding rows), then the remaining rows are sorted before iteration:

${query [[
  from
    p = index.tag 'page'
  group by
    p.tags[1]
  select {
    tag = key,
    big_by_size = array_agg(p.name order by p.size desc) filter(where p.size > 5)
  }
  order by
    tag
  limit
    5
]]}

### Null handling
The `nulls first` and `nulls last` modifiers work inside intra-aggregate `order by` the same way they do in the query-level `order by`:

```lua
query [[
  from
    p = data
  group
    by p.category
  select {
    cat = key,
    items = array_agg(p.name
      order by
        p.priority asc nulls last
    )
  }
]]
```

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
* [[Space Lua/Lua Integrated Query]] — full LIQ language reference and listing available aggregates
