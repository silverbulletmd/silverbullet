---
description: APIs to define virtual pages
tags: meta/api
---
Virtual pages are (read-only) pages that don't actually exist in your space, but are dynamically generated on the fly. Used to implement [[^Library/Std/Infrastructure/Tag Page]]

# API

## virtualPage.define(def)
Defines a virtual page for specified pattern. Repeated calls with the same `pattern` merge (set a field to `config.unset` to remove it). Options:
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
```space-lua
-- priority: 99
virtualPage = virtualPage or {}

--- Defines a read-only virtual page generated for page names matching `pattern`, or merges `def` into an existing one.
--- @param def table { pattern: string, run: function(...) }; `run` receives the captured groups of the Lua pattern and returns the page text
function virtualPage.define(def)
  config.merge({"virtualPages", def.pattern}, def)
end
```

```space-lua
-- priority: -1
event.listen {
  name = "editor:pageCreating",
  run = function(e)
    local pageName = e.data.name
    for _, def in pairs(config.get("virtualPages", {})) do
      local match = pageName:match(def.pattern)
      if match != nil then
        return {
          text = def.run(match),
          perm = "ro"
        }
      end
    end
  end
}
```
