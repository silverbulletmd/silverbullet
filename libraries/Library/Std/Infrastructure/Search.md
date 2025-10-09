---
description: Implements the tag page
tags: meta
---

Implements a [[^Library/Std/APIs/Virtual Page]] (prefixed with `search:`) exposing full-text search.

# Implementation

```space-lua
-- priority: 5
command.define {
  name = "Search Space",
  key = "Ctrl-Shift-f",
  mac = "Cmd-Shift-f",
  run = function()
    local phrase = editor.prompt "Search for:"
    if phrase then
      editor.navigate("search:" .. phrase)
    end
  end
}

virtualPage.define {
  pattern = "search:(.+)",
  run = function(phrase)
    local results = search.ftsSearch(phrase)
    local pageText = "# Search results for '" .. phrase .. "'\n"
    for r in each(results) do
      pageText = pageText .. spacelua.interpolate("* [[${r.id}|${r.id}]] (score ${r.score})\n", {r=r})
    end
    return pageText
  end
}
```
