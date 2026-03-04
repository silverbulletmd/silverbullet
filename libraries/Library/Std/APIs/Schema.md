---
description: Helper functions for building JSON Schema objects in Lua
tags: meta/api
---

Helper functions for succinctly defining JSON Schema types in Lua. Used with [[API/tag#tag.define(spec)]] and [[API/config#config.define(key, schema)]].

# API

## schema.string()
Returns `{type = "string"}`.

## schema.number()
Returns `{type = "number"}`.

## schema.boolean()
Returns `{type = "boolean"}`.

## schema.null()
Returns `{type = "null"}`.

## schema.array(typ)
Returns an array schema with items of the given type. `typ` can be a type string (e.g. `"string"`) or a full schema table.

Example:

```lua
schema.array("string")    -- {type = "array", items = {type = "string"}}
schema.array {
    type = "object",
    properties = {
        name = {type = "string"}
    }
}
```

## schema.nullable(typ)
Allows the given type or null. `typ` can be a type string or a schema table.

## schema.nullableArray(typ)
An array of the given type, or null.

## schema.func()
Marker for function-typed values.

## schema.schema()
Marker for schema-typed values.

# Implementation

```space-lua
-- priority: 101
schema = schema or {}

function schema.string()
  return { type = "string" }
end

function schema.number()
  return { type = "number" }
end

function schema.boolean()
  return { type = "boolean" }
end

function schema.array(typ)
  if type(typ) == "string" then
    return {
      type = "array",
      items = { type = typ }
    }
  else
    return {
      type = "array",
      items = typ,
    }
  end
end

function schema.nullable(typ)
  if type(typ) == "string" then
    return {
      anyOf = {
        { type = typ },
        { type = "null" },
      }
    }
  else
    return {
      anyOf = {
        typ,
        { type = "null" },
      }
    }
  end
end

function schema.nullableArray(typ)
  if type(typ) == "string" then
    return {
      anyOf = {
        { type = "array",
          items = { type = typ } },
        { type =  "null" },
      }
    }
  else
    return {
      anyOf = {
        { type = "array",
          items = typ, },
        { type = "null" },
      }
    }
  end
end

-- Used to specify we're expecting a function, but doesn't deeply validate
function schema.func()
  return {}
end

-- Used to specify we're expecting a schema, but doesn't deeply validate
function schema.schema()
  return { type = "object" }
end

function schema.null()
  return { type = "null" }
end
```
