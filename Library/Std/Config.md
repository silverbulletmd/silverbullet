#meta

Config library for defining and getting config values

```space-lua
-- priority: 10
config = {}

local configValues = {}
local configSchema = {}

function config.define(key, schema)
  configSchema[key] = schema or true
end

function config.set(keyOrTable, value)
  if type(keyOrTable) == "table" then
    for key, value in pairs(keyOrTable) do
      config.set(key, value)
    end
    return
  end
  local key = keyOrTable
  local schema = configSchema[key]
  if schema == nil then
    error("Config key not defined: " .. key)
  end
  if schema != true then
    local result = jsonschema.validateObject(schema, value)
    if result != nil then
      error("Validation error (" .. key .. "): " .. result)
    end
  end
  configValues[key] = value
end

function config.get(key)
  return configValues[key]
end
