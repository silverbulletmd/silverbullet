# JSON Schema API

The JSON Schema API provides functions for validating JSON objects against JSON schemas.

## Validation Operations

### jsonschema.validate_object(schema, object)
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
local error = jsonschema.validate_object(schema, object)
if error then
    print("Validation error: " .. error)
else
    print("Object is valid")
end
```

### jsonschema.validate_schema(schema)
Validates a JSON schema itself to ensure it's well-formed.

Example:
```lua
local schema = {
    type = "object",
    properties = {
        name = {type = "string"}
    }
}

local error = jsonschema.validate_schema(schema)
if error then
    print("Schema error: " .. error)
else
    print("Schema is valid")
end
``` 