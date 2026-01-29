#meta/api

Implements convenience functions for accessing tag objects.

Currently:

* `tags.someTag` is an alias for `index.tag "someTag`

Example:

${#query[[from tags.page]]}

# Implementation

```space-lua
-- priority: 50
tag = tag or {}

function tag.define(spec)
  local finalSpec = config.get({"tags", spec.name}, {})
  local metatable = nil
  for k, v in pairs(spec) do
    if k == "metatable" then
      metatable = v
    else
      finalSpec[k] = v
    end
  end
  config.set({"tags", spec.name}, finalSpec)
  if metatable then
    config.setLuaValue({"tags", spec.name, "metatable"}, metatable)
  end
end

-- Set up tags.* short cut via meta tables
tags = setmetatable({}, {
  __index = function(self, tag)
    return index.tag(tag)
  end
})
```
