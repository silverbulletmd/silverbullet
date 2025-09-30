#meta

Implements convenience functions for accessing tag objects.

Currently:

* `tags.someTag` is an alias for `index.tag "someTag`

Example:

${#query[[from tags.page]]}

# Implementation

```space-lua
-- priority: 50
tags = setmetatable({}, {
  __index = function(self, tag)
    return index.tag(tag)
  end
})
```
