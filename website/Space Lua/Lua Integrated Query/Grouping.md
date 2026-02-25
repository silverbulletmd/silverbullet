#maturity/experimental

The `group by` and `having` clauses extend [[Space Lua/Lua Integrated Query]] with SQL-style grouping and aggregate filtering.

After `group by`, each result row has two fields:

- **`key`** - the group key (single value or table for multi-key)
- **`group`** - a table (array) of all items in that group

The field names used in `group by` are also available as bare variables in `having`, `select`, and `order by`. Use `#group` to count items per group.

> **note** Note
> `having` can only reference group key fields, `key`, `group`, and aggregates like `#group`. To filter individual rows, use `where`.

# Examples

All examples below use `index.tag 'tag'`.

## Group by single key

Group all tags by `name`:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
]]}

## Group by multiple keys

Group tags by `name` and `parent` together:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
]]}

## Filter groups by count

Only show tags that appear more than 2 times:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group > 2
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group > 2
]]}

## Find unique tags

Tags appearing exactly once:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group == 1
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group == 1
]]}

## Filter groups by key value

Only show the group where `name` is "meta":

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    name == 'meta'
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    name == 'meta'
]]}

## Multi-key having

Groups by `name` and `parent`, keep only page-level tags with more than 1 entry:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  having
    parent == 'page' and
    #group > 1
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  having
    parent == 'page' and
    #group > 1
]]}

## `where` before `group by`

Filter to page parents first, then group by `name`:

```lua
query [[
  from
    index.tag 'tag'
  where
    parent == 'page'
  group by
    name
]]
```

${query [[
  from
    index.tag 'tag'
  where
    parent == 'page'
  group by
    name
]]}

## `where`, `group by` and `having` combined

Filter to page parents, group by `name`, keep groups with 2+ items:

```lua
query [[
  from
    index.tag 'tag'
  where
    parent == 'page'
  group by
    name
  having
    #group >= 2
]]
```

${query [[
  from
    index.tag 'tag'
  where
    parent == 'page'
  group by
    name
  having
    #group >= 2
]]}

## `select` name and count

Project each group into a table with `name` and `count`:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  select {
    name = name,
    count = #group
  }
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  select {
    name = name,
    count = #group
  }
]]}

## `select` with multi-key

Project both key parts and count:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  select {
    name = name,
    parent = parent,
    count = #group
  }
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  select {
    name = name,
    parent = parent,
    count = #group
  }
]]}

## Full pipeline: `where`, `group by`, `having` and `select`

Filter, group, filter groups, then project:

```lua
query [[
  from
    index.tag 'tag'
  where
    parent == 'page' or
    parent == 'task'
  group by
    name
  having
    #group > 1
  select {
    tag = name,
    total = #group
  }
]]
```

${query [[
  from
    index.tag 'tag'
  where
    parent == 'page' or
    parent == 'task'
  group by
    name
  having
    #group > 1
  select {
    tag = name,
    total = #group
  }
]]}

## Order groups by count

Sort groups by size, largest first:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  order by
    #group desc
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  order by
    #group desc
]]}

## Top tags with `having`, `order by`, and `select`

Tags with 2+ occurrences, sorted by count, projected:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    count = #group
  }
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    count = #group
  }
]]}

## Top N groups with `limit`

Top 3 most used tags:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  order by
    #group desc
  limit
    3
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  order by
    #group desc
  limit
    3
]]}

## Full pipeline with `limit`

Top 5 tags with 2+ uses, showing name and count:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    count = #group
  }
  limit
    5
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    count = #group
  }
  limit
    5
]]}

## With explicit object variable

The same works with `p =` binding:

```lua
query [[
  from
    p = index.tag 'tag'
  group by
    p.name
  having
    #group > 1
  select {
    tag = name,
    count = #group
  }
]]
```

${query [[
  from
    p = index.tag 'tag'
  group by
    p.name
  having
    #group > 1
  select {
    tag = name,
    count = #group
  }
]]}

## Multi-key with explicit object variable

Full pipeline with `p =` binding and two group keys:

```lua
query [[
  from
    p = index.tag 'tag'
  where
    p.parent == 'page'
  group by
    p.name,
    p.parent
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    parent = parent,
    count = #group
  }
]]
```

${query [[
  from
    p = index.tag 'tag'
  where
    p.parent == 'page'
  group by
    p.name,
    p.parent
  having
    #group >= 2
  order by
    #group desc
  select {
    tag = name,
    parent = parent,
    count = #group
  }
]]}

## Access `key` directly

For single-key grouping, `key` holds the value directly:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name
  having
    key == 'meta'
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name
  having
    key == 'meta'
]]}

## Access `key` table for multi-key

For multi-key grouping, `key` is a table indexed from 1:

```lua
query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  having
    key[1] == 'meta' and
    key[2] == 'page'
]]
```

${query [[
  from
    index.tag 'tag'
  group by
    name,
    parent
  having
    key[1] == 'meta' and
    key[2] == 'page'
]]}
