#maturity/experimental

The `group by` and `having` clauses extend [[Space Lua/Integrated Query]] with SQL-style grouping and aggregate filtering.

After `group by`, each result row has two fields:

- **`key`** - the group key (single value or table for multi-key)
- **`group`** - a table (array) of all items in that group

The field names used in `group by` are also available as bare variables in `having`, `select`, and `order by`. Use `#group` to count items per group.

> **note** Note
> `having` can only reference group key fields, `key`, `group`, aggregate expressions like `#group`, and aggregate functions like `count()`. To filter individual rows, use `where`.

# Examples

All examples below use `tags.tag`.

## Group by single key
Group all tags by `name`:

${query [[
  from
    t = tags.tag
  group by
    t.name
  limit 5
]]}

## Group by multiple keys
Group tags by `name` and `parent` together:

${query[[
  from
    t = tags.tag
  group by
    t.name,
    t.parent
  limit 5
]]}

## Filter groups by count
Only show tags that appear more than 2 times:

${query[[
  from
    t = tags.tag
  group by
    t.name
  having
    #group > 2
  limit 5
]]}

## Find unique tags
Tags appearing exactly once:

${query[[
  from
    t = tags.tag
  group by
    t.name
  having
    #group == 1
  select key
]]}

## Filter groups by key value
Only show the group where `name` is "meta":

${query[[
  from
    tags.tag
  group by
    name
  having
    name == "meta"
]]}

${query[[
  from
    t = tags.tag
  group by
    t.name
  having
    t.name == "meta"
]]}

## Multi-key having

Groups by `name` and `parent`, keep only page-level tags with more than 1 entry:

${query [[
  from
    tags.tag
  group by
    name,
    parent
  having
    parent == 'page' and
    #group > 1
]]}

## `where` before `group by`

Filter to page parents first, then group by `name`:

${query [[
  from
    tags.tag
  where
    parent == 'page'
  group by
    name
]]}

## `where`, `group by` and `having` combined

Filter to page parents, group by `name`, keep groups with 2+ items:
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
