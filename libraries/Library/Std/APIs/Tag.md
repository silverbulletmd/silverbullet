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

-- For future use
function tag.define(spec)
  config.set("tagDefinitions", spec.name, spec)
end

-- Set up tags.* short cut via meta tables
tags = setmetatable({}, {
  __index = function(self, tag)
    return index.tag(tag)
  end
})
```
