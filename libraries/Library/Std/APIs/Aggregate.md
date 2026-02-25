---
description: APIs to define custom aggregate functions for LIQ
tags: meta/api
---

APIs to define and override aggregate functions used in [[Space Lua/Lua Integrated Query|LIQ]] `select` and `having` clauses after `group by`.

Built-in aggregates: `count`, `sum`, `min`, `max`, `avg` and `array_agg`.

# API

## aggregate.define(spec)

Defines a new aggregate function. Required keys:

* `name`: name of the aggregate (used in queries as `name(expr)`)
* `initialize`: function that returns the initial state
* `iterate`: function(state, value) that returns updated state

Optional keys:

* `description`: description of the aggregate
* `finish`: `function(state)` that transforms the final state into the result

## aggregate.update(spec)

Updates an existing aggregate definition. Same keys as `aggregate.define`. Only the provided keys are overwritten.

# Examples

## Define a custom aggregate

Define a custom aggregate `concat` that concatenates strings.

```lua
aggregate.define {
  name = 'concat',

  initialize = function()
    return ''
  end,

  iterate = function(state, value)
    if state == '' then
      return tostring(value)
    end
    return state .. ', ' .. tostring(value)
  end,
}
```

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
  }
}

function aggregate.define(spec)
  local validationResult = jsonschema.validateObject(aggregateSchema, spec)

  if validationResult then
    error('aggregate.define: ' .. validationResult)
  end

  config.set({'aggregates', spec.name}, spec)
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

  config.set({'aggregates', spec.name}, existing)
end
```
