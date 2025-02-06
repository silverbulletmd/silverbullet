The YAML API provides functions for parsing and stringifying YAML content.

### yaml.parse(text)
Parses a YAML string into a Lua table.

Example:
```lua
local text = [[
name: John
age: 30
hobbies:
  - reading
  - hiking
]]

local data = yaml.parse(text)
print(data.name)  -- prints: John
print(data.hobbies[1])  -- prints: reading
```

### yaml.stringify(obj)
Converts a Lua table into a YAML string.

Example:
```lua
local data = {
    name = "John",
    age = 30,
    hobbies = {"reading", "hiking"}
}

local yamlText = yaml.stringify(data)
print(yamlText)
```
