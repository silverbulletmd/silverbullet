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

event.listen {
  name = "readURI:https:*",
  run = function(e)
    local uri = e.data.uri
    return http.request(uri).body
  end
}

function readURI(uri, options)
  options = options or {}
  options.uri = uri
  local results = event.dispatch("readURI:" .. uri, options)
  if #results == 0 then
    return nil
  elseif #results == 1 then
    return results[1]
  else
    print("Got multipe response", results)
    error("Too many response")
  end
end
```
