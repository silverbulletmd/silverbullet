---
description: Implements the infrastructure for reading and writing to URIs
tags: meta
---

# Implementation
```space-lua
-- priority: 10
-- Virtual page (uri:URI)
virtualPage.define {
  pattern = "uri:.+",
  run = function(path)
    local uri = path:sub(#"uri:"+1)
    return net.readURI(uri .. ".md", {encoding="text/markdown"})
  end
}

service.define {
  selector = "net.readURI:https:*",
  match = {},
  -- nil for a missing page; any other failure is an error, so an error
  -- page never passes for content
  run = function(data)
    local res = net.proxyFetch(data.uri)
    if res.status == 404 then
      return nil
    end
    if not res.ok then
      error("Could not read " .. data.uri .. ": HTTP " .. res.status)
    end
    return res.body
  end
}
```
