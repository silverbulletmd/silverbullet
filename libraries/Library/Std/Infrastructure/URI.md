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
    return net.readURI(uri .. ".md", {encoding="text/markdown"})
  end
}

service.define {
  selector = "net.readURI:https:*",
  match = {},
  run = function(data)
    return net.proxyFetch(data.uri).body
  end
}

```
