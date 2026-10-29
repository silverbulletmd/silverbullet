---
description: Helper functions for building JSON Schema objects in Lua
tags: meta/api
---

Helper functions for succinctly defining JSON Schema types in Lua.

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

## schema.ref(tagName?)
A reference to a page or object, stored as a single wikilink such as `"[[Person/Alice]]"` or `"[[$task1]]"`. Returns `{type = "string", format = "ref", tag = tagName}`. The optional `tagName` names the tag the referenced object is expected to have.

## schema.enum(values)
A string restricted to the given list of values. Returns `{type = "string", enum = values}`.

## schema.date()
A date string. Returns `{type = "string", format = "date"}`.

## schema.tags(extra?)
Tag names, written either as a YAML list or as one string separated by spaces or commas (`tags: project glossary`). A leading `#` is optional. Returns an `anyOf` of a list of `{type = "string", format = "tag"}` and a `{type = "string", format = "tags"}`. Keys of the optional `extra` table (`description`, `nullable`, …) are added to the result. The frontmatter form edits these as `#tag` chips with completion.

```lua
schema.tags { description = "Topics" }
```

## schema.identities(extra?)
`@names`, as a list or one string, like `schema.tags()`; a leading `@` is optional. Uses the formats `identity` and `identities`. The form edits these as `@name` chips that complete from known identities.

## schema.func()
Marker for function-typed values.

## schema.object()
Marker for any object values.

## schema.schema()
Marker for schema-typed values.

# Implementation

```space-lua
-- priority: 101
schema = schema or {}

--- Schema for a string value.
--- @return table `{ type = "string" }`
--- @see Schema
function schema.string()
  return { type = "string" }
end

--- Schema for a number value.
--- @return table `{ type = "number" }`
--- @see Schema
function schema.number()
  return { type = "number" }
end

--- Schema for a boolean value.
--- @return table `{ type = "boolean" }`
--- @see Schema
function schema.boolean()
  return { type = "boolean" }
end

--- Schema for an array whose items have the given type.
--- @param typ string|table a type name such as "string", or a full schema table
--- @return table an array schema
--- @see Schema
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

--- Schema for a reference to a page or object, stored as a single wikilink string.
--- @param tagName? string the tag the referenced object is expected to have
--- @return table `{ type = "string", format = "ref", tag = tagName }`
--- @see Schema
function schema.ref(tagName)
  return { type = "string", format = "ref", tag = tagName }
end

--- Schema for a string restricted to the given values.
--- @param values string[] the allowed values
--- @return table `{ type = "string", enum = values }`
--- @see Schema
function schema.enum(values)
  return { type = "string", enum = values }
end

--- Schema for a date string.
--- @return table `{ type = "string", format = "date" }`
--- @see Schema
function schema.date()
  return { type = "string", format = "date" }
end

local function listOrString(item, list, extra)
  local result = {
    anyOf = {
      { type = "array", items = { type = "string", format = item } },
      { type = "string", format = list },
    },
  }
  for k, v in pairs(extra or {}) do result[k] = v end
  return result
end

--- Schema for tag names, as a list or one string separated by spaces or commas; a leading `#` is optional.
--- @param extra? table keys (such as description or nullable) added to the result
--- @return table an anyOf schema of a tag list or a tags string
--- @see Schema
function schema.tags(extra)
  return listOrString("tag", "tags", extra)
end

--- Schema for `@names`, as a list or one string, like `schema.tags()`; a leading `@` is optional.
--- @param extra? table keys (such as description or nullable) added to the result
--- @return table an anyOf schema of an identity list or an identities string
--- @see Schema
function schema.identities(extra)
  return listOrString("identity", "identities", extra)
end

--- Schema that allows the given type or null.
--- @param typ string|table a type name or a full schema table
--- @return table an anyOf schema of the type and null
--- @see Schema
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

--- Schema for an array of the given type, or null.
--- @param typ string|table the item type name or schema table
--- @return table an anyOf schema of the array and null
--- @see Schema
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

--- Marker for function-typed values; does not validate deeply.
--- @return table an empty schema
--- @see Schema
function schema.func()
  return {}
end

--- Marker for schema-typed values; does not validate deeply.
--- @return table `{ type = "object" }`
--- @see Schema
function schema.schema()
  return { type = "object" }
end

--- Marker for any object value.
--- @return table `{ type = "object" }`
--- @see Schema
function schema.object()
  return { type = "object" }
end

--- Schema for the null value.
--- @return table `{ type = "null" }`
--- @see Schema
function schema.null()
  return { type = "null" }
end
```
