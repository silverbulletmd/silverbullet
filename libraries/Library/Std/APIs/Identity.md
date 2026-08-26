#meta/api

Implements the API for defining identities addressable with `@name`.

# API

## identity.define(def)
Defines an identity. Options:
* `name` _(required)_: the name it is addressed by, without the `@`. Matched case-insensitively.
* `description`: shown beside the name in autocomplete.

Accounts with access to the space are identities already and need no definition. Use this for teams, projects, agents — anything addressable that is not an account.

## identity.own()
Returns the identity the current user is, as `{ name, id, detail? }`, or nil when the space does not know.

# Example
```lua
identity.define {
  name        = "sales",
  description = "Sales team",
}
```

# Implementation

```space-lua
-- priority: 50
identity = identity or {}

function identity.define(spec)
  config.set({"identities", spec.name}, spec)
end

-- The identity the current user is, or nil when the space does not know.
-- An anonymous reader of a public space is nobody; so is the App on a local
-- space, which has a current user but no name for them.
function identity.own()
  local me
  for _, account in ipairs(system.listAccounts()) do
    if account.me and account.username then
      me = account.username:lower()
    end
  end
  if not me then return end
  for _, r in ipairs(system.invokeFunction("index.listIdentities")) do
    if r.name:lower() == me then return r end
  end
end
```
