---
description: Implements exporting to Github repo files.
tags: meta
---
[[^Library/Std/Infrastructure/Import]] and [[^Library/Std/Infrastructure/Export]] support for [Github repo files](https://github.com).

# Configuration
If you only want to _import_ from Github URLs, no configuration is required.

To _export_ got a Github repo, you need to get a [personal Github token](https://github.com/settings/personal-access-tokens) (with repo permissions). Configure your token somewhere in Space Lua (use a `space-lua` block), ideally a `SECRETS` page. This configuration is shared with [[^Library/Std/Infrastructure/Gist]].

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
  fmUrlKey = "githubUrl",
}
```

## Import
```space-lua
-- Import discovery
event.listen {
  name = "import:discover",
  run = function(event)
    local url = event.data.url
    if github.extractData(url) then
      return {
        {
          id = "github-file",
          name = "Github: Repo file",
        },
      }
    end
  end
}

-- Import implementation
event.listen {
  name = "import:run:github-file",
  run = function(event)
    local url = event.data.url
    local repo, branch, path = github.extractData(url)
    -- Fetch content via the Github API, unauthenticated
    local resp = http.request(github.buildUrlWithBranch(repo, branch, path), {method = "GET"})
    if not resp.ok then
      editor.flashNotification("Failed, see console for error")
      js.log("Error", resp)
      return
    end
    local content = encoding.utf8Decode(encoding.base64Decode(resp.body.content))
    local fm = index.extractFrontmatter(content)
    local suggestedPath = path:gsub("%.md$", "")
    if table.includes(fm.frontmatter.tags, "meta") then
      -- Maybe more of a library function
      suggestedPath = "Library/" .. suggestedPath
    end
    -- Ask for location to import to
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
      {op="set-key", path=github.fmUrlKey, value=url}
    })
    editor.setText(updated)
  end
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

-- Export discovery
event.listen {
  name = "export:discover",
  run = function(event)
    return {
      {
        id = "github-file",
        name = "Github: Repo file"
      },
    }
  end
}

-- Export implementation
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
  name = "readURI:ghr",
  match = function()
    return {priority=10}
  end,
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
  name = "readURI:github",
  match = function()
    return {priority=10}
  end,
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
  name = "readURI:github:url",
  match = function()
    return {priority=10}
  end,
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
