---
description: Implements the infrastructure for reading and writing to URIs
tags: meta
---

# Implementation
```space-lua
-- Virtual page (uri:URI)
virtualPage.define {
  pattern = "uri:.+",
  run = function(path)
    local uri = path:sub(#"uri:"+1)
    print("Now going to do readURL on", uri)
    return readURI(uri .. ".md", {encoding="text/markdown"})
  end
}

service.define {
  selector = "readURI:https:*",
  name = "readURI:https",
  match = function()
    -- Fallback
    return {}
  end,
  run = function(data)
    return http.request(data.uri).body
  end
}

function readURI(uri, options)
  options = options or {}
  options.uri = uri
  return service.invokeBestMatch("readURI:" .. uri, options)
end
```
