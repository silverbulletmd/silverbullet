---
tags: api/space-lua
references:
- plug-api/syscalls/jsonschema.ts
- client/plugos/syscalls/jsonschema.ts
---

The JSON Schema API provides functions for validating JSON objects against JSON schemas.

<!--#lua spacelua.renderApiDocumentation("jsonschema") -->
## jsonschema.inferFromObject

`jsonschema.inferFromObject(object)`

Infers a best-effort draft 2020-12 JSON Schema from a sample value.

**Parameters:**

- `object` — Sample value whose shape is inferred.

**Returns:**

- `table` — Inferred schema marked x-inferred.

**Example:**

```lua
local schema = jsonschema.inferFromObject({name = "Widget", count = 3})
```

## jsonschema.validateObject

`jsonschema.validateObject(schema, object)`

Validates a value against a JSON Schema.

**Parameters:**

- `schema` (`table`) — JSON Schema to apply.
- `object` — Value to validate.

**Returns:**

- `string` — Validation error, or nil when valid.

**Example:**

```lua
local schema = {type = "object", properties = {name = {type = "string"}}, required = {"name"}}
local err = jsonschema.validateObject(schema, {name = "John"})
```

## jsonschema.validateSchema

`jsonschema.validateSchema(schema)`

Checks whether a JSON Schema has a supported top-level shape.

**Parameters:**

- `schema` — JSON Schema to validate.

**Returns:**

- `string` — Schema error, or nil when valid.

**Example:**

```lua
local err = jsonschema.validateSchema({type = "object"})
```
<!--/lua-->

