#meta

Config library for defining and getting config values

```space-lua
-- priority: 10
config = {}

local config_values = {}
local config_schema = {}

function config.define(key, schema)
  config_schema[key] = schema or true
end

function config.set(key, value)
  local schema = config_schema[key]
  if schema == nil then
    error("Config key not defined: " .. key)
  end
  if schema != true then
    local result = jsonschema.validate_object(schema, value)
    if result != nil then
      error("Validation error (" .. key .. "): " .. result)
    end
  end
  config_values[key] = value
end

function config.get(key)
  return config_values[key]
end
```