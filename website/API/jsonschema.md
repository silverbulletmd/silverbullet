# JSON Schema API

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
