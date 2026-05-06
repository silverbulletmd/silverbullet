---
description: APIs to define custom aggregate functions for SLIQ
tags: meta/api
---

APIs to define and override aggregate functions used in SLIQ `select` and `having` clauses after `group by`.

All aggregates skip null/nil values by convention. Empty groups return null (except `count` which returns 0 and `string_agg` which returns an empty string).

# Querying available aggregates

All aggregates (built-in, user-defined, and aliases) are queryable via `index.aggregates()`:

```lua
-- List all
${query[[from index.aggregates()]]}

-- Only builtins
${query[[from index.aggregates() where builtin]]}

-- Only aliases
${query[[from index.aggregates() where target]]}

-- Only user-defined (non-builtin, non-alias)
${query[[from index.aggregates() where not builtin and not target]]}
```

Each row includes the following columns: `builtin`, `name`, `description`, `initialize`, `iterate`, `finish`, and `target`. The `initialize`, `iterate`, and `finish` columns are represented by boolean values.

# API

## aggregate.define(spec)

Defines a new aggregate function. Required keys:

* `name`: name of the aggregate (used in queries as `name(expr)`)
* `initialize`: function that returns the initial state
* `iterate`: function(state, value) that returns updated state

Optional keys:

* `description`: description of the aggregate
* `finish`: `function(state)` that transforms the final state into the result

### Extra arguments

Aggregate functions can accept additional arguments beyond the first value expression. When called as `my_agg(expr, arg2, arg3)`, the extra arguments (`arg2`, `arg3`) are evaluated once before iteration and forwarded to all three callbacks:

* `initialize(ctx, ...extraArgs)` — receives extra args after the context table
* `iterate(state, value, ctx, ...extraArgs)` — receives extra args after the context table
* `finish(state, ctx, ...extraArgs)` — receives extra args after the context table

This allows parameterized aggregates, for example a separator argument for string concatenation or boundary arguments for clamped sums.

## aggregate.update(spec)

Updates an existing aggregate definition. Same keys as `aggregate.define`. Only the provided keys are overwritten.

## aggregate.alias(name, target, description?)

Creates an alias so that `name` resolves to `target` at query time. The target may be a builtin, a user-defined aggregate, or another alias (chains are followed with cycle detection).

```lua
aggregate.alias("total", "sum")
aggregate.alias("stdev", "stddev_pop", "My stddev alias")
```

# Examples

## Define a custom aggregate with one extra argument

Define a custom aggregate `concat` that concatenates strings with a configurable separator (defaulting to `", "`):

```lua
aggregate.define {
  name = 'concat',

  initialize = function(ctx, sep)
    return { sep = sep or ', ', parts = {} }
  end,

  iterate = function(state, value)
    if value ~= nil then
      state.parts[#state.parts + 1] = tostring(value)
    end
    return state
  end,

  finish = function(state)
    return table.concat(state.parts, state.sep)
  end,
}
```

Usage in a query:

```lua
query [[
  from p = data
  group by p.category
  select {
    cat        = key,
    names      = concat(p.name),
    names_dash = concat(p.name, " - ")
  }
]]
```

## Define a custom aggregate with two extra arguments

Define a custom aggregate `clamp_sum` that sums non-null inputs and clamps the result to a `[min, max]` range:

```lua
aggregate.define {
  name = 'clamp_sum',
  description = 'Sum of non-null inputs clamped to [min, max]',

  initialize = function(ctx, lo, hi)
    return { total = 0, lo = lo or -math.huge, hi = hi or math.huge }
  end,

  iterate = function(state, value)
    if value ~= nil then
      state.total = state.total + value
    end
    return state
  end,

  finish = function(state)
    if state.total < state.lo then return state.lo end
    if state.total > state.hi then return state.hi end
    return state.total
  end,
}
```

Usage in a query:

```lua
query [[
  from
    d = {
      { dept = "eng",   hours = 12 },
      { dept = "eng",   hours = 35 },
      { dept = "sales", hours = 8  },
      { dept = "sales", hours = 6  },
    }
  group by d.dept
  select {
    dept  = d.dept,
    total = clamp_sum(d.hours, 0, 40),
  }
]]
```

Here `eng` sums to 47 but is clamped to `40`, while `sales` sums to `14` which is within range.

## Update an existing aggregate

```lua
aggregate.update {
  name = 'count',
  description = 'Custom count aggregate that counts even nils',

  iterate = function(state, value)
    return state + 1
  end,
}
```

## Create an alias

```lua
aggregate.alias("total", "sum")
aggregate.alias("stdev", "stddev_pop", "Shorthand for population stddev")
```

# Implementation

```space-lua
-- priority: 50
aggregate = aggregate or {}

local aggregateSchema = {
  type = 'object',

  required = {
    'name',
    'initialize',
    'iterate'
  },

  properties = {
    name = schema.string(),
    description = schema.string(),
    initialize = schema.func(),
    iterate = schema.func(),
    finish = schema.func(),
    -- Enable wildcard calls like `my_agg(t.*)` and `my_agg(*)`.
    -- Note: Set to `true` only if `iterate` handles whole rows!
    acceptsWildcardArg = schema.boolean(),
  }
}

function aggregate.define(spec)
  local validationResult = jsonschema.validateObject(aggregateSchema, spec)

  if validationResult then
    error('aggregate.define: ' .. validationResult)
  end

  config.setLuaValue({'aggregates', spec.name}, spec)
end

function aggregate.update(spec)
  if not spec.name then
    error('aggregate.update: name is required')
  end

  local existing = config.get({'aggregates', spec.name}, {})

  for k, v in pairs(spec) do
    existing[k] = v
  end

  if not existing.initialize then
    error('aggregate.update: aggregate '
      .. spec.name .. ' has no initialize after merge')
  end

  if not existing.iterate then
    error('aggregate.update: aggregate '
      .. spec.name .. ' has no iterate after merge')
  end

  config.setLuaValue({'aggregates', spec.name}, existing)
end

function aggregate.alias(name, target, description)
  if not name or not target then
    error('aggregate.alias: both name and target are required')
  end
  if name == target then
    error('aggregate.alias: name and target must differ')
  end
  local entry = { alias = target }
  if description then
    entry.description = description
  end
  config.setLuaValue({'aggregates', name}, entry)
end

-- Standard aliases
aggregate.alias('every', 'bool_and')
aggregate.alias('std', 'stddev_pop')
aggregate.alias('stddev', 'stddev_pop')
aggregate.alias('variance', 'var_pop')
aggregate.alias('group_concat', 'string_agg')
```
