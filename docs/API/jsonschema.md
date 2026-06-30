---
tags: api/space-lua
references:
- plug-api/syscalls/jsonschema.ts
- client/plugos/syscalls/jsonschema.ts
---

The JSON Schema API provides functions for validating JSON objects against JSON schemas.

## Validation Operations

### jsonschema.validateObject(schema, object)
Validates a JSON object against a JSON schema.

Example:
```lua
local schema = {
    type = "object",
    properties = {
        name = {type = "string"},
        age = {type = "number", minimum = 0}
    },
    required = {"name"}
}

local object = {name = "John", age = 30}
local error = jsonschema.validateObject(schema, object)
if error then
    print("Validation error: " .. error)
else
    print("Object is valid")
end
```

### jsonschema.inferFromObject(object)
Infers a best-effort JSON schema from the *shape* of a single sample value. Types are guessed from one example, so the result is a hint rather than a contract — the returned schema is marked with `"x-inferred": true`. Useful when an object type has no declared schema but you have an example to learn from.

Example:
```lua
local sample = { name = "Widget", count = 3, tags = { "a", "b" } }
local schema = jsonschema.inferFromObject(sample)
-- schema.properties.name.type  == "string"
-- schema.properties.count.type == "integer"
-- schema.properties.tags.type  == "array"  (items.type == "string")
```

### jsonschema.validateSchema(schema)
Validates a JSON schema itself to ensure it's well-formed.

Example:
```lua
local schema = {
    type = "object",
    properties = {
        name = {type = "string"}
    }
}

local error = jsonschema.validateSchema(schema)
if error then
    print("Schema error: " .. error)
else
    print("Schema is valid")
end
