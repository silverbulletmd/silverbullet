---
tags: meta
---
Space Lua Integrated Query (SLIQ) — query syntax for SilverBullet data.

Syntax:
  from <var> = index.tag "<type>"
  [where <condition>]
  [order by <expr> [asc|desc] [nulls first|last] [, ...]]
  [group by <expr> [, ...]]
  [having <condition>]
  [select <expr>]
  [limit <n> [, <offset>]]
  [offset <n>]

Clauses can appear in any order. Only `from` is required.
Always use variable binding: `from p = index.tag "page"` (not `from index.tag "page"`).

Operators: ==, ~= (not equal), <, >, <=, >=, and, or, not
String: s:startsWith("x"), s:endsWith("x"), s:contains("x")
Tables: table.includes(t, val), table.select(t, "k1", "k2", ...)

Grouping:
  After `group by`, each row has `key` (the group key) and `group` (array of items).
  Use `#group` for count. Multi-key: `group by p.x, p.y` makes `key` a table ({key[1], key[2]}).
  `having` filters groups after grouping (can use aggregates).

Aggregates (in select/having, with or without group by):
  count(expr), sum(expr), min(expr), max(expr), avg(expr), array_agg(expr)
  With ordering: array_agg(p.name order by p.name asc)
  With filter:   count(p.size) filter(where p.size > 100)

Projection:
  select p.name                              -- single field
  select {name=p.name, count=#group}         -- construct table
  select table.select(p, "name", "tags")     -- pick specific fields from object

Examples:
  query 'from t = index.tag "task" where not t.done'
  query 'from p = index.tag "page" order by p.lastModified desc limit 10'
  query 'from t = index.tag "task" group by t.page select {page=key, count=#group}'
  query 'from p = index.tag "page" select table.select(p, "name", "lastModified") limit 5'
  query 'from l = index.tag "link" where l.toPage == "MyPage"'
