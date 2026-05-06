# SLIQ - Space Lua Integrated Query

SLIQ (Space Lua Integrated Query) is a SQL/LINQ-inspired declarative query language embedded in Lua, specific to SilverBullet. It operates on any iterable Lua collection, with first-class support for indexed tag collections via `index.tag(name)`.

---

## Architecture

SLIQ is structured in layers, each handling a distinct concern of query processing.

**datastore.** The key-value persistence layer, backed by IndexedDB. All indexed data and query collections are stored here. SLIQ never reads from the datastore directly; access is always mediated through higher-level indices.

**bitmap index.** A roaring bitmap index over the datastore. For each tag (collection type), it maintains per-column compressed bitsets that map column values to object IDs. Values are dictionary-encoded for compact storage. A column is automatically indexed when its cardinality is low enough (`NDV/rowCount <= 0.5` and at least 50 rows); the columns `page` and `tag` are always indexed. The index also maintains NDV and MCV (Most Common Values) statistics used by the cost-based planner. The index is either trusted (fully built, pushdown enabled) or untrusted (still building, pushdown disabled).

**augmenter.** An in-memory cache that decorates indexed objects with mutable per-client metadata such as `lastAccessed` or `lastRun`. Data is persisted in the datastore under a separate namespace and loaded at query time. The augmenter exposes virtual columns that do not exist in the bitmap index, along with per-column statistics. Each tag has at most one augmenter.

**object index and query collections.** The object index coordinates the bitmap index, augmenter, and datastore. Calling `tag(name)` returns a query collection that implements `.query()` to run SLIQ queries and `.getStats()` to supply planner statistics. During execution, the collection loads the augmenter, binds the where clause, dispatches predicates to engines, intersects the resulting ID sets, materializes rows, and applies the remaining query stages.

**query engines.** Each engine advertises what predicates it can evaluate, claims the ones it can handle, and returns matching object IDs or rows. Four engines exist: the bitmap engine (priority 20, pushes equality and range predicates to roaring bitmaps), the augmenter engine (priority 25, resolves predicates against the in-memory cache), the array scan engine (priority 10, yields rows from a materialized array with no pushdown), and the compute fallback engine (priority 5, evaluates any predicate row-by-row as a safety net). Engines are instantiated per-query from a snapshot; planning is synchronous, execution may perform I/O.

**predicate binding and dispatch.** The where expression is normalized into a structured predicate tree: operands are canonicalized (column on the left, literal on the right), nil idioms are collapsed (`p.col` to `is-not-nil`, `not p.col` to `is-nil`), OR chains on the same column are rewritten to IN, and negations are pushed inward. The dispatcher then asks each engine to claim the sub-trees it can handle. Engines only claim AND composites; OR branches remain unclaimed. The resulting ID sets are intersected, and any unclaimed predicates are evaluated row-by-row afterward.

**join planner.** For queries with multiple sources, a cost-based planner determines the optimal join order and physical operators. It extracts equi-join and range predicates, orders sources with a greedy optimizer that minimizes intermediate row count, builds a left-deep join tree, and selects between hash, loop, or merge joins. Cardinality estimation uses MCV overlap when trusted statistics are available, NDV fanout as a fallback, or a simple heuristic when no equi predicate exists. Partial statistics are treated conservatively, inflating NDV estimates fourfold.

**query language.** The SLIQ syntax is parsed by a Lezer grammar into an AST. All clauses are recognized regardless of their position in the source. Wildcard forms and aggregate calls with intra-clause `order by` and `filter(where ...)` are recognized at the grammar level.

---

## Syntax

```
query [[
    [ explain ( analyze | verbose | costs | timing | summary | hints
                | analyze = bool | verbose = bool | costs = bool
                | timing = bool | summary = bool | hints = bool [, ...] ) ]
    [ leading name [, ...] ]
    from from_field [, ...]
    [ where expression ]
    [ group by select_field [, ...] ]
    [ having expression ]
    [ order by order_by_expr [, ...] ]
    [ limit expression [, expression] ]
    [ offset expression ]
    [ select [ distinct | all ] select_field [, ...] ]
]]
```

All clauses are optional except `from`. Clause order is arbitrary; the planner applies them in logical sequence.

### from

```
from from_field [, ...]

from_field:
    [ materialized ] [ join_hint ] [ name = ] expression [ with_clause ]

join_hint:
    join_type join_method
  | join_method join_type

join_type:
    inner | semi | anti

join_method:
    hash | merge | loop [ using name | using function ... end ]

with_clause:
    with with_entry [, ...]
  | with ( with_entry [, ...] )

with_entry:
    rows number | width number | cost number
```

Join hints (`inner`, `semi`, `anti`, `hash`, `merge`, `loop`) precede the source binding. The `materialized` keyword forces the result set to be fully evaluated into an in-memory array before join execution. The `with` clause overrides planner estimates for row count, column width, and source cost.

Bind a single source with an alias.

```lua
query [[
  from
    p = index.tag "page"
]]
```

Two sources with explicit join methods and types.

```lua
query [[
  from
    hash inner p = index.tag "page",
    merge semi t = index.tag "tag"
]]
```

Source with planner estimate overrides.

```lua
query [[
  from
    p = index.tag "page" with (rows 1000, width 5)
]]
```

Force the source to be fully evaluated before join execution.

```lua
query [[
  from
    materialized p = index.tag "page"
]]
```

### leading

```
leading name [, ...]
```

Fixes the source order for the join planner, overriding the cost-based optimizer. The planner still selects physical join operators. Ignored when stats are `persisted-partial` (unreliable).

Force the join planner to use `p` as the leading source, then `t`.

```lua
query [[
  from
    p = index.tag "page",
    t = index.tag "tag"
  leading
    t, p
  where
    p.name == t.name
]]
```

### where

```
where expression
```

Any Lua expression. When truthy, the row is kept. Same-column equality OR chains collapse to IN internally.

Filter on a specific column value.

```lua
where
  p.namespace == "docs"
```

Match against a list of values.

```lua
where
  p.name in { "Home", "Index" }
```

Method call on a column value (evaluated row-by-row).

```lua
where
  p.name:startsWith("Doc")
```

### group by

```
group by select_field [, ...]

select_field:
    expression
  | name = expression
  | *
  | name .*
  | * . name
```

Output rows contain `key` (group key value, or a table for multi-key) and `group` (array of original items). Group key fields are available as bare variables in `having`, `select`, and `order by`. Non-aggregated field references resolve to the first item in the group.

Group by a single field.

```lua
group by
  p.name
```

Group by multiple fields.

```lua
group by
  p.namespace,
  p.tag
```

Group by an indexed array element.

```lua
group by
  p.tags[1]
```

### having

```
having expression
```

Filters after grouping. When no `group by` is present, filters the single implicit group (at most one row returned). Aggregate functions, `key`, `group`, and group key fields are accessible.

Filter groups by the number of items.

```lua
having
  #group > 2
```

Filter using an aggregate function and the group key.

```lua
having
  count(p.name) > 2 and key
```

Without a `group by` clause, the `having` clause filters the single implicit group.

```lua
having
  sum(n) > 5
```

Bare function names matching registered aggregates are treated as aggregates; use `_G.name()` to call a global of the same name.

### order by

```
order by order_by_expr [, ...]

order_by_expr:
    expression [ asc | desc | using name | using function ... end ]
               [ nulls first | nulls last ]
  | [ expression ]
  | *
  | name .*
  | * . name
```

Default is ascending. Nulls: last for asc, first for desc. `using` comparators must satisfy strict weak ordering (use `<` or `>`, not `<=` or `>=`); violations are detected at runtime. The keyword `using` is reserved.

Sort by a column in descending order.

```lua
order by
  p.lastModified desc
```

Multiple sort keys with mixed directions.

```lua
order by
  p.lastModified desc,
  p.name asc
```

Explicit null placement.

```lua
order by
  p.priority desc nulls last
```

Custom comparator function.

```lua
order by
  n using function(a, b)
    return #a < #b
  end
```

### limit

```
limit expression [, expression]
```

First argument is the row count; optional second argument is an inline offset.

Limit to three rows.

```lua
limit 3
```

Limit with an inline offset.

```lua
limit 3, 2
```

### offset

```
offset expression
```

Skips rows from the beginning. If both inline offset (in `limit`) and standalone `offset` are present, the last encountered wins. Offset exceeding the result set returns empty.

Skip the first two rows.

```lua
offset 2
```

Offset followed by a limit.

```lua
offset 2 limit 3
```

### select

```
select [ distinct | all ] select_field [, ...]

select_field:
    expression
  | name = expression
  | *
  | name .*
  | * . name
  | [ expression ] = expression
```

Projects and transforms rows. If omitted, returns the original items. `distinct` deduplicates output rows.

Select a single field.

```lua
select
  p.name
```

Select named fields into a table.

```lua
select
  {
    name = p.name,
    modified = p.lastModified
  }
```

Select distinct values.

```lua
select
  distinct p.namespace
```

Expand all fields from a source.

```lua
select { p.* }
```

Select a single field from all sources.

```lua
select { *.name }
```

### Aggregate calls

```
aggregate_name ( [ distinct | all ] arg_item [, ... ]
                   [ order by order_by_expr [, ...] ]
                 )
                 [ filter ( where expression ) ]

arg_item:
    expression
  | *
  | name .*
  | * .*
```

Available aggregates: `count`, `sum`, `avg`, `min`, `max`, `array_agg`, `json_agg`, `string_agg(expr, sep)`.

Count non-null values.

```lua
count(p.name)
```

Count all rows.

```lua
count(*)
```

Count with a filter clause.

```lua
count(p.name) filter (where p.size > 10)
```

Aggregate with an intra-call order by.

```lua
array_agg(p.name order by p.lastModified desc)
```

Aggregate with both order by and filter.

```lua
string_agg(p.name, ", " order by p.name)
  filter (where p.published)
```

### explain

```
explain [ option ... ] [ ( option [, ...] ) ]

option:
    analyze | verbose | costs | timing | summary | hints
  | analyze = bool | verbose = bool | costs = bool
  | timing = bool | summary = bool | hints = bool
  | number
```

Boolean options accept `true`, `false`, `on`, `off`, `1`, or `0`.

Explain with default options.

```lua
explain
```

Explain with specific options in parentheses.

```lua
explain ( analyze, verbose )
```

Mix standalone and parenthesized options.

```lua
explain analyze verbose (costs on, timing off)
```

---

## NULL Handling

Missing columns in wildcard expansions surface as `SLIQ_NULL`, a sentinel distinct from Lua `nil`.

---

## Pushdown Rules

Predicate pushdown routes where sub-trees to engines that can evaluate them without full row materialization. Pushdown is an optimization; the residual where is always evaluated row-by-row as a correctness safety net.

### Bitmap Engine

Requires: trusted index, indexed column, literal operand. Claimable predicates: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`. AND composites only.

Equality predicate on an indexed column pushed to the bitmap engine.

```lua
query[[
  from
    p = index.tag "page"
  where
    p.namespace == "docs"
]]
```

IN list pushed to the bitmap engine.

```lua
query[[
  from
    p = index.tag "page"
  where
    p.name in {"Home", "Index"}
]]
```

Function call cannot be pushed and falls back to row-by-row evaluation.

```lua
query[[
  from
    p = index.tag "page"
  where
    p.name:startsWith("Doc")
]]
```

### Augmenter Engine

Requires: loaded augmenter, owned column. Claimable: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `is-nil`, `is-not-nil`. AND composites only. Bare `p.col` normalizes to `is-not-nil`; `not p.col` to `is-nil`. Pure `is-nil` conjunctions trigger scan of all object IDs in the relation, exclude cached keys. The `lastAccessed` virtual column stores ISO 8601 string timestamps.

Pushdown into the augmenter engine for a virtual column comparison on `lastAccessed`.

```lua
query[[
  from
    p = index.tag "page"
  where
    p.lastAccessed and
    p.lastAccessed > "2026-01-01T00:00:00.000"
]]
```

Nil check pushed to the augmenter engine to find pages that were never accessed.

```lua
query[[
  from
    p = index.tag "page"
  where
    not p.lastAccessed
]]
```

### Composite engine claims

When both bitmap and augmenter can claim parts of a where clause, their id-sets are intersected.

```lua
query[[
  from
    p = index.tag "page"
  where
    p.namespace == "docs" and
    p.lastAccessed > "2026-01-01T00:00:00.000"
]]
```

The `p.namespace == "docs"` predicate is claimed by the bitmap engine; `p.lastAccessed > "2026-01-01T00:00:00.000"` is claimed by the augmenter engine. The two id-sets are intersected.

### What is not pushed

- OR composites (never pushed to any engine)
- Function calls (always compute fallback)
- Arithmetic expressions (always compute fallback)
- Multi-source references (become join residual)

### Transitive pushdown

During join planning, if `a.x == 'value'` and `a.x == b.y`, the planner generates `b.y == 'value'` and pushes it to `b`'s engines, enabling bitmap pushdown on both sides of an equi join.

---

## Execution Pipeline

1. Parse to AST (Lezer grammar)
2. Extract clauses

   Single source:

     a. Build LuaQueryCollection
     b. dispatchPredicate() to intersect engine id-sets
     c. resolveIds() to materialize rows
     d. applyQuery(): residual where, group by, having,
        select (aggregates), order by, distinct, limit

   Multi-source (join planner):

     a. Extract equi, range, and single-source predicates
     b. Generate transitive predicates
     c. orderSources() with greedy cost optimizer
     d. buildJoinTree() to left-deep tree
     e. Materialize each source (single-source path)
     f. executeJoinTree() with hash, loop, or merge joins
     g. Residual where on joined rows, then post-processing

---

## Join Planner Detail

### Source Ordering

Greedy optimizer. If `leading` hint is provided, those sources are fixed first. Otherwise: pick the smallest source, then iteratively add the source that minimizes `(outputRows + sourceCost) * scanPenalty * (widthWeight * joinedWidth + candidateWidthWeight * candidateWidth)`. When stats are `persisted-partial` (unreliable), aggressive reordering is skipped.

Scan penalties: bitmap with pushdown is 0.6, index without pushdown is 2.0, KV scan is 1.4, default is 1.0. Width weights: `widthWeight = 1`, `candidateWidthWeight = 2`.

### Cardinality Estimation

Three-tier: (1) MCV overlap when both sides have trusted stats; (2) NDV fanout `leftRows * (rightNdv / leftNdv) * rightRowsPerKey`; (3) no-equi fallback `1 / max(leftRows, rightRows)`. Range predicates multiply selectivity by 0.33 each. Semi and anti joins receive a 0.5 nested-loop discount.

Stats confidence: `persisted-complete` is 1.0 (exact), `persisted-partial` is 0.25 (NDV inflated four times), `computed-sketch-large` is 0.5 (NDV doubled), `unknown-default` is 0.5.

### Physical Operators

Hash join is the default for equi joins when the right side has at least 20 rows. Loop join is selected when the right side has fewer than 20 rows, no equi predicate exists, or an explicit hint is given. Merge join is considered when both sides exceed 200 rows, an equi predicate exists, and merge cost is lower than hash or loop.

Join types: `inner` (all matching pairs), `semi` (left rows with at least one match, deduplicated), `anti` (left rows with no match). Watchdog limit is 500,000 intermediate rows.
