#meta

Implements useful embed widgets.

# Youtube
## Example
${embed.youtube "https://youtu.be/t1oy_41bDAY?si=X76FvJEUlJnApwEg"}

# Peertube
## Example 
${embed.peertube "https://peertube.fr/w/kkGMgK9ZtnKfYAgnEtQxbv"}

# Vimeo
## Example
${embed.vimeo "https://vimeo.com/1084537"}

# Implementation
```space-lua
-- Schema
local embedVideoSpecSchema = {
  type = "object",
  properties = {
    url = { type = "string"},
    width = { type = "number"},
    height = { type = "number"},
  },
  required = {"url"}
}

-- Youtube widget
function embed.youtube(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
  -- Validate spec
  local validationResult = jsonschema.validateObject(embedVideoSpecSchema, specOrUrl)
  if validationResult then
    error(validationResult)
  end
  local videoId = string.match(specOrUrl.url, "youtube%.com/watch%?v=(.+)")
  if not videoId then
    videoId = string.match(specOrUrl.url, "youtu%.be/(.+)")
  end

  if not videoId then
    error("No video id found")
  end
  
  local width = specOrUrl.width or "100%"
  local height = specOrUrl.height or "400px"
  return widget.html(dom.iframe {
    src="https://www.youtube.com/embed/" .. videoId,
    style="width: " .. width .. "; height: " .. height,
    class = "sb-video-embed",
    referrerpolicy = "strict-origin-when-cross-origin"
  })
end

-- Peertube widget
function embed.peertube(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
 -- Validate spec
  local validationResult = jsonschema.validateObject(embedVideoSpecSchema, specOrUrl)
  if validationResult then
    error(validationResult)
  end
  
  local tempHost = string.match(specOrUrl.url, "https://(.+)")
  local lastIndex = string.find(tempHost, "/w/")
  local peertubeInstance = string.sub(tempHost, 1, (lastIndex -1) )
  local videoId = string.match(specOrUrl.url, "/w/(.+)")

  if not videoId then
    error("No video id found")
  end
  
  local width = specOrUrl.width or "100%"
  local height = specOrUrl.height or "400px"
  return widget.html(dom.iframe {
    src = "https://" .. peertubeInstance .. "/videos/embed/" .. videoId,
    style = "width: " .. width .. "; height: " .. height,
    frameborder = "0",
    allowfullscreen = "",
    sandbox = "allow-same-origin allow-scripts allow-popups allow-forms",
    class = "sb-video-embed"
  })
end

-- Vimeo widget
function embed.vimeo(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
  -- Validate spec
  local validationResult = jsonschema.validateObject(embedVideoSpecSchema, specOrUrl)
  if validationResult then
    error(validationResult)
  end
  local videoId = string.match(specOrUrl.url, "vimeo%.com/(.+)")

  if not videoId then
    error("No video id found")
  end
  
  local width = specOrUrl.width or "100%"
  local height = specOrUrl.height or "400px"
  return widget.html(dom.iframe {
    src = "https://player.vimeo.com/video/" .. videoId,
    style = "width: " .. width .. "; height: " .. height,
    frameborder = "0", 
    referrerpolicy = "strict-origin-when-cross-origin", 
    allow = "fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share",   
    allowfullscreen = "",
    class = "sb-video-embed"
  })
end
```

## Styling

```space-style
.sb-video-embed {
  border: 0 !important;
}
```

# General implementation
```space-lua
-- priority: 50
embed = {}
```
