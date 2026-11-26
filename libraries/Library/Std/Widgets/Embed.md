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

# Size
Each embed takes an optional `width` and `height`. A number is in pixels, and a string is any CSS size. The defaults are `"100%"` wide and `400` high.

${embed.youtube {url = "https://youtu.be/t1oy_41bDAY", width = 560, height = 315}}

# Implementation
```space-lua
-- priority: 10
local embedVideoSpecSchema = {
  type = "object",
  properties = {
    url = { type = "string"},
    width = { type = {"number", "string"}},
    height = { type = {"number", "string"}},
  },
  required = {"url"}
}

-- A number is a size in pixels; a string (e.g. "100%" or "20em") is used as is
local function cssSize(value, default)
  if value == nil then
    return default
  end
  if type(value) == "number" then
    return value .. "px"
  end
  return value
end

function embed.youtube(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
  local validationResult = jsonschema.validateObject(embedVideoSpecSchema, specOrUrl)
  if validationResult then
    error(validationResult)
  end
  local videoId = string.match(specOrUrl.url, "youtube%.com/watch%?v=(.+)")
  if not videoId then
    videoId = string.match(specOrUrl.url, "youtu%.be/(.+)")
  end
  if not videoId then
    videoId = string.match(specOrUrl.url, "youtube%.com/shorts/(.+)")
  end

  if not videoId then
    error("No video id found")
  end
  
  local width = cssSize(specOrUrl.width, "100%")
  local height = cssSize(specOrUrl.height, "400px")
  return widget.html(dom.iframe {
    src="https://www.youtube.com/embed/" .. videoId,
    style="width: " .. width .. "; height: " .. height,
    class = "sb-video-embed",
    referrerpolicy = "strict-origin-when-cross-origin",
    allow = "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share",
    allowfullscreen = "true",
  })
end

function embed.peertube(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
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
  
  local width = cssSize(specOrUrl.width, "100%")
  local height = cssSize(specOrUrl.height, "400px")
  return widget.html(dom.iframe {
    src = "https://" .. peertubeInstance .. "/videos/embed/" .. videoId,
    style = "width: " .. width .. "; height: " .. height,
    frameborder = "0",
    allowfullscreen = "",
    sandbox = "allow-same-origin allow-scripts allow-popups allow-forms",
    class = "sb-video-embed"
  })
end

function embed.vimeo(specOrUrl)
  if type(specOrUrl) == "string" then
    specOrUrl = { url = specOrUrl }
  end
  local validationResult = jsonschema.validateObject(embedVideoSpecSchema, specOrUrl)
  if validationResult then
    error(validationResult)
  end
  local videoId = string.match(specOrUrl.url, "vimeo%.com/(.+)")

  if not videoId then
    error("No video id found")
  end
  
  local width = cssSize(specOrUrl.width, "100%")
  local height = cssSize(specOrUrl.height, "400px")
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
