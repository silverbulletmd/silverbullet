---
description: APIs to define virtual pages
tags: meta/api
---
Virtual pages are (read-only) pages that don't actually exist in your space, but are dynamically generated on the fly. Used to implement [[^Library/Std/Infrastructure/Tag Page]]

# API

## virtualPage.define(def)
Defines a virtual page for specified pattern. Options:
* `pattern`: a Lua regular expression, e.g. `"myprefix:(.+)"` the captured groups will be passed as arguments to the `run` function
* `run`: a callback function where each captured group in the regex will be passed as an argument

# Example
```lua
virtualPage.define {
  -- match any page name starting with "newtag:"
  pattern = "newtag:(.+)",
  run = function(name)
    return "Page:" .. name
  end
}
```

# Implementation
Resolution happens in the client (TypeScript), so this Lua API only needs to
record definitions. SilverBullet reads `config.virtualPages` directly when a
page is being loaded — see `client/virtual_pages.ts`.

```space-lua
-- priority: 99
virtualPage = virtualPage or {}

-- options:
--   pattern
--   run()
function virtualPage.define(def)
  config.set({"virtualPages", def.pattern}, def)
end
```
