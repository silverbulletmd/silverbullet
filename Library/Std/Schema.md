#meta

Utilities to succinctly define JSON schema types.

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

function schema.func()
  return {}
end
```