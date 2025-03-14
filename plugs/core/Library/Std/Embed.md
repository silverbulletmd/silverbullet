#meta
Implements useful embeds

# Youtube
## Example
${embed.youtube "https://youtu.be/t1oy_41bDAY?si=X76FvJEUlJnApwEg"}

## Implementation

```space-lua
-- Schema
local youtubeSpecSchema = {
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
  local validationResult = jsonschema.validateObject(youtubeSpecSchema, specOrUrl)
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
  return widget.new {
    html = "<iframe src='https://www.youtube.com/embed/"
      .. videoId
      .. "' style='width: " .. width
      .. "; height: " .. height .. "'></iframe>",
    cssClasses = {"sb-youtube-embed"}
  }
end
```

## Styling

```space-style
.sb-youtube-embed {
  border: 0;
}
```

# General implementation
```space-lua
-- priority: 5
embed = {}
```
