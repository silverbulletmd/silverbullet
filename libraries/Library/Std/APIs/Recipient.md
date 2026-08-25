#meta/api

Implements the API for defining recipients addressable with `@name`.

# API

## recipient.define(def)
Defines a recipient. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are recipients already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

# Example
```lua
recipient.define {
  name        = "sales",
  description = "Sales team",
}
```

# Implementation

```space-lua
-- priority: 50
recipient = recipient or {}

function recipient.define(spec)
  config.set({"recipients", spec.name}, spec)
end
```
