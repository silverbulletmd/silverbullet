---
description: Integration with Github repositories and gists.
tags: meta
---
[[^Library/Std/Infrastructure/Export]] support for [Github repo files](https://github.com).

# Configuration
If you only want to read from Github URLs, no configuration is required.

To write to Github repo, you need to get a [personal Github token](https://github.com/settings/personal-access-tokens) (with repo permissions). Configure your token somewhere in Space Lua (use a `space-lua` block), ideally a `SECRETS` page. This configuration is shared with [[^Library/Std/Infrastructure/Gist]].

```lua
config.set("github.token", "your token")
```

In addition, you need to configure a name and email that will be part of the commit:

```lua
config.set("github.name", "John Doe")
config.set("github.email", "john@doe.com")
```

# Implementation

## Constants
```space-lua
-- priority: 50
github = {
}
```

## Export
```space-lua
-- returns (something/bla, branch, path)
function github.extractData(url)
  if url == nil then
    return nil
  end
  return url:match("github%.com/([^/]+/[^/]+)/[^/]+/([^/]+)/(.+)")
end

function github.buildUrl(repo, path)
  return "https://api.github.com/repos/" .. repo .. "/contents/" .. path
end

function github.buildUrlWithBranch(repo, branch, path)
  return github.buildUrl(repo, path) .. "?ref=" .. branch
end

function github.checkConfig()
  if not config.get("github.token") then
    error("github.token needs to be set")
  end
  if not config.get("github.name") then
    error("github.name needs to be set")
    return
  end
  if not config.get("github.email") then
    error("github.email needs to be set")
    return
  end
end

-- Export implementation
-- TO BE FIXED
event.listen {
  name = "export:run:github-file",
  run = function(event)
    -- Check configuration
    local checkOk, err = pcall(github.checkConfig)
    if not checkOk then
      editor.flashNotification(err, "error")
      return
    end
    -- Extract the URL from frontmatter if set
    local text = event.data.text
    local fm = index.extractFrontmatter(text, {
      removeKeys = {github.fmUrlKey},
    })
    local repo, branch, path = github.extractData(fm.frontmatter[github.fmUrlKey])
    local sha = nil -- will be set for existing files
    if not repo then
      -- Not there? This will be a new file
      repo = editor.prompt "Github repo (user/repo):"
      if not repo then
        return
      end
      branch = editor.prompt("Branch:", "main")
      if not branch then
        return
      end
      path = editor.prompt("File path:", editor.getCurrentPage() .. ".md")
      if not path then
        return
      end
    else
      -- We did find an existing file, let's fetch it to get the SHA
      local oldContent = githubGist.request(github.buildUrlWithBranch(repo, branch, path), "GET")
      if not oldContent.ok then
        editor.flashNotification("Could not fetch existing file", "error")
        return
      end
      sha = oldContent.body.sha
    end
    -- Ask for a commit message
    local message = editor.prompt("Commit message:", "Commit")
    -- Push the change
    local resp = githubGist.request(github.buildUrl(repo, path), "PUT", {
      message = message,
      committer = {
        name = config.get("github.name"),
        email = config.get("github.email"),
      },
      branch = branch,
      sha = sha,
      content = encoding.base64Encode(fm.text)
    })
    if resp.ok then
      editor.flashNotification "Published file successfully"
      local url = "https://github.com/" .. repo .. "/blob/" .. branch .. "/" .. path
      local updated = index.patchFrontmatter(editor.getText(),
      {
        {op="set-key", path=github.fmUrlKey, value=url}
      })
      editor.setText(updated)
      editor.flashNotification "Done!"
    else
      editor.flashNotification("Error, check console")
      js.log("Error", resp)
    end
  end
}
```

# Read URI support
```space-lua
-- Supports:
--   ghr:owner/repo/path (latest)
--   ghr:owner/repo@version/path
service.define {
  selector = "readURI:ghr:*",
  match = { priority=10 },
  run = function(data)
    local uri = data.uri:sub(#"ghr:"+1)
    local owner, repo, path = table.unpack(uri:split("/"))
    local repoClean, version = table.unpack(repo:split("@"))
    local url
    if not version or version == "latest" then
      url = "https://api.github.com/repos/"
            .. owner .. "/" .. repoClean .. "/releases/latest"
    else
      url = "https://api.github.com/repos/" .. owner .. "/" .. repoClean .. "/releases/tags/" .. version
    end
    local res = http.request(url)
    if res.status != 200 then
      print("Could not fetch", url, res)
      return
    end
    local releaseInfo = res.body
    version = releaseInfo.tag_name
    local url = "https://github.com/" .. owner .. "/" .. repoClean .. "/releases/download/" .. version .. "/" .. path
    local res = http.request(url, {responseEncoding=data.encoding})
    if res.status != 200 then
      print("Failed to fetch", ur, res)
      return nil
    end
    return res.body
  end
}

-- Supports:
--   github:owner/repo/path (defaults to "main" branch)
--   github:owner/repo@branch/path
service.define {
  selector = "readURI:github:*",
  match = { priority=10 },
  run = function(data)
    local uri = data.uri:sub(#"github:"+1)
    local owner, repo, path, branch
    owner, repo, path = table.unpack(uri:split("/"))
    repo, branch = table.unpack(repo:split("@"))
    if not branch then
      branch = "main"
    end
    local url = "https://raw.githubusercontent.com/" .. owner .. "/" .. repo .. "/" .. branch .. "/" .. path
    local res = http.request(url)
    if res.status != 200 then
      return nil
    end
    return res.body
  end
}

-- Supports:
--   https://github.com/owner/repo/blob/branch/path
service.define {
  selector = "readURI:https://github.com/*",
  match = {priority=10},
  run = function(data)
    local owner, repo, branch, path = data.uri:match("github%.com/([^/]+)/([^/]+)/[^/]+/([^/]+)/(.+)")
    local url = "https://raw.githubusercontent.com/" .. owner .. "/" .. repo .. "/" .. branch .. "/" .. path
    local res = http.request(url)
    if res.status != 200 then
      return nil
    end
    return res.body
  end
}
```

# Export implementation
```space-lua
-- Utility functions
function github.extractGistId(url)
  if not url:startsWith("https://gist.github.com/") then
    return nil
  end
  return url:match("([^/]+)$")
end

function github.request(url, method, body)
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

service.define {
  selector = "export",
  match = {
    name = "Github Gist: Export",
    priority=10
  },
  run = function(data)
    -- Extract any existing gist URLs
    local text = data.text
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

# ReadURI and WriteURI support
```space-lua
-- Supports
--   https://gist.github.com/user/gistid
service.define {
  selector = "readURI:https://gist.github.com/*",
  match = {priority=10},
  run = function(data)
    local gistId = github.extractGistId(data.uri)
    local resp = http.request("https://api.github.com/gists/" .. gistId)
    if resp.status != 200 then
      print("Failed to fetch gist", resp)
      return nil
    end
    local files = resp.body.files
    for filename, data in pairs(files) do
      if data.content then
        return data.content
      end
    end
    return nil
  end
}

service.define {
  selector = "writeURI:https://gist.github.com/*",
  match = {priority=10},
  run = function(data)
    local gistId = github.extractGistId(data.uri)
    
    -- First fetch the gist to find the file name
    local resp = http.request("https://api.github.com/gists/" .. gistId)
    if not resp.ok then
      editor.flashNotification("Failed, see console for error", "error")
      js.log("Error", resp)
      return
    end
    local files = resp.body.files
    local selectedFilename
    for filename, meta in pairs(files) do
      if filename:endsWith(".md") then
        selectedFilename = filename
        break
      end
    end
    if not selectedFilename then
      editor.flashNotification("Could not find markdown file in gist", "error")
      js.log("Error", resp)
      return
    end
    local resp = github.request("https://api.github.com/gists/" .. gistId, "PATCH", {
      public = true,
      files = {
        [selectedFilename] = {
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
}
```
