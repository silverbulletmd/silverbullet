SilverBullet relies on [JSON Schema](https://json-schema.org) for various types of validation, specifically:

* [[Tag#Custom tags]]
* [[^Library/Std/Config]] options

Often these schemas are encoded using [[Space Lua]], so take the shape of:

```lua
local schema = {
  type = "object",
  properties = {
    -- ...
  }
}
```

There are is the [[^Library/Std/APIs/Schema]] API for convenience.