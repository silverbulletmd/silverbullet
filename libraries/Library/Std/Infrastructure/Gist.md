---
description: Implements exporting to Github Gists.
tags: meta
---
[[^Library/Std/Infrastructure/Import]] and [[^Library/Std/Infrastructure/Export]] support for [Github Gists](https://gist.github.com/).

# Configuration
If you only want to _import_ from Gist URLs, no configuration is required.

To _export_ gists, you need to get a [personal Github token](https://github.com/settings/personal-access-tokens) (with at least Gist permissions). Configure your token somewhere in Space Lua (use a `space-lua` block):

```lua
config.set("github.token", "your token")
```

# Implementation: constants
```space-lua
-- priority: 50
githubGist = {
  fmUrlKey = "gistUrl",
  fmFileKey = "gistFile"
}
```

# Import implementation
```space-lua
-- Import discovery
event.listen {
  name = "import:discover",
  run = function(event)
    local url = event.data.url
    if githubGist.extractGistId(url) then
      return {
        {
          id = "github-gist",
          name = "Github: Gist"
        },
      }
    end
  end
}

-- Gist export implementation
event.listen {
  name = "import:run:github-gist",
  run = function(event)
    local url = event.data.url
    local gistUrl = githubGist.extractGistId(url)
    local resp = http.request("https://api.github.com/gists/" .. gistUrl)
    if not resp.ok then
      editor.flashNotification("Failed, see console for error")
      js.log("Error", resp)
      return
    end
    local files = resp.body.files
    for filename, meta in pairs(files) do
      if filename:endsWith(".md") then
        -- Fetch the content
        local content = http.request(meta.raw_url).body
        local fm = index.extractFrontmatter(content)
        local suggestedPath = filename:gsub("%.md$", "")
        if table.includes(fm.frontmatter.tags, "meta") then
          -- Maybe more of a library function
          suggestedPath = "Library/" .. suggestedPath
        end
        local localPath = editor.prompt("Save to", suggestedPath)
        if not localPath then
          return
        end
        if space.fileExists(localPath .. ".md") then
          editor.flashNotification("Page already exists, won't do that", "error")
          return
        end
        space.writePage(localPath, content)
        editor.flashNotification("Imported to " .. localPath)
        editor.navigate({kind="page", page=localPath})
        local updated = index.patchFrontmatter(editor.getText(),
        {
          {op="set-key", path="source", value="github-gist"},
          {op="set-key", path=githubGist.fmUrlKey, value=resp.body.html_url},
          {op="set-key", path=githubGist.fmFileKey, value=filename},
        })
        editor.setText(updated)
      end
    end
  end
}
```

# Export implementation
```space-lua
-- Utility functions
function githubGist.extractGistId(url)
  if not url:startsWith("https://gist.github.com/") then
    return nil
  end
  return url:match("([^/]+)$")
end

function githubGist.request(url, method, body)
  local token = config.get("github.token")
  if not token then
    error("github.token config not set")
  end
  return http.request(url, {
    method = method,
    headers = {
      Authorization = "token " .. token,
      Accept = "application/vnd.github+json"
    },
    body = body
  })
end

-- Export discovery
event.listen {
  name = "export:discover",
  run = function(event)
    return {
      {
        id = "github-gist",
        name = "Github: Gist"
      },
    }
  end
}

-- Gist export implementation
event.listen {
  name = "export:run:github-gist",
  run = function(event)
    -- Extract any existing gist URLs
    local text = event.data.text
    local fm = index.extractFrontmatter(text, {
      removeKeys = {githubGist.fmUrlKey, githubGist.fmFileKey}
    })
    if not fm.frontmatter[githubGist.fmUrlKey] then
      -- Not there? This will be a fresh gist
      local filename = "content.md"
      filename = editor.prompt("File name", filename)
      if not filename then
        return
      end
      local resp = githubGist.request("https://api.github.com/gists", "POST", {
        public = true,
        files = {
          [filename] = {
            content = fm.text
          }
        }
      })
      if resp.ok then
        editor.flashNotification "Published new gist successfully"
        local updated = index.patchFrontmatter(editor.getText(),
        {
          {op="set-key", path=githubGist.fmUrlKey, value=resp.body.html_url},
          {op="set-key", path=githubGist.fmFileKey, value=filename},
        })
        editor.setText(updated)
        editor.flashNotification "Done!"
      else
        editor.flashNotification("Error, check console")
        js.log("Error", resp)
      end
    else
      -- Already published, should update
      local gistId = githubGist.extractGistId(fm.frontmatter[githubGist.fmUrlKey])
      local resp = githubGist.request("https://api.github.com/gists/" .. gistId, "PATCH", {
        public = true,
        files = {
          [fm.frontmatter[githubGist.fmFileKey]] = {
            content = fm.text
          }
        }
      })
      if resp.ok then
        editor.flashNotification "Updated gist successfully!"
      else
        editor.flashNotification("Error, check console")
        js.log("Error", resp)
      end
    end
  end
}
```
