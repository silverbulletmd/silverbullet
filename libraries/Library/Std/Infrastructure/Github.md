---
description: Integration with Github repositories and gists.
tags: meta
---
Support for [SilverBullet Share](https://silverbullet.md/Share) for:

* Github repo files
* Github gists

As well as [URI](https://silverbullet.md/URIs) support (both read and write) for the following schemes:
* `https://github.com/username/repo/blob/branch/path`
* `https://gist.github.com/username/gist-id`
* `github:username/repo@branch/path`
* `github:username/repo/path` (defaults to `main` branch)
* `ghr:username/repo@version/path` (github release support)

# Configuration
If you only want to read from Github URLs, no configuration is required.

To _write_ to Github repos and gists, you need to get a [personal Github token](https://github.com/settings/personal-access-tokens) (with repo and gists permissions). Configure your token somewhere in Space Lua (use a `space-lua` block), ideally a `SECRETS` page.

```lua
config.set("github.token", "your token")
```

In addition, to push to Github repos you need to configure a name and email that will be part of the commit:

```lua
config.set("github.name", "John Doe")
config.set("github.email", "john@doe.com")
```

# Implementation

## Constants
```space-lua
-- priority: 50
github = {}
```

## Github Repo Files
```space-lua
-- returns (something/bla, branch, path)
function github.extractData(url)
  if url == nil then
    return nil
  end
  return url:match("github%.com/([^/]+/[^/]+)/[^/]+/([^/]+)/(.+)")
end

function github.buildAPIURL(repo, path)
  return "https://api.github.com/repos/" .. repo .. "/contents/" .. path
end

function github.buildAPIURLWithBranch(repo, branch, path)
  return github.buildAPIURL(repo, path) .. "?ref=" .. branch
end

function github.buildURI(repo, branch, path)
  return "https://github.com/" .. repo .. "/blob/" .. branch .. "/" .. path
end

function github.request(url, method, body)
  local token = config.get("github.token")
  if not token then
    error("github.token config not set")
  end
  return net.proxyFetch(url, {
    method = method,
    headers = {
      Authorization = "token " .. token,
      Accept = "application/vnd.github+json"
    },
    body = body
  })
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

service.define {
  selector = "share:onboard",
  match = {
    name = "Github file",
    description = "Share this page as a file on a github repo",
  },
  run = function(data)
    local name = data.name
    local content = data.text
    -- Check configuration
    local checkOk, err = pcall(github.checkConfig)
    if not checkOk then
      editor.flashNotification(err, "error")
      return
    end
    repo = editor.prompt "Github repo (user/repo):"
    if not repo then
      return
    end
    branch = editor.prompt("Branch:", "main")
    if not branch then
      return
    end
    path = editor.prompt("File path:", name .. ".md")
    if not path then
      return
    end
    -- Ask for a commit message
    local message = editor.prompt("Commit message:", "Commit")
    -- Push the change
    local resp = github.request(github.buildAPIURL(repo, path), "PUT", {
      message = message,
      committer = {
        name = config.get("github.name"),
        email = config.get("github.email"),
      },
      branch = branch,
      content = encoding.base64Encode(content)
    })
    if resp.ok then
      local uri = github.buildURI(repo, branch, path)
      return {
        uri = uri,
        hash = share.contentHash(content),
        mode = "push"
      }
    else
      js.log("Error", resp)
      error("Error, check console")
    end
  end
}

-- writeURI support
service.define {
  selector = "net.writeURI:https://github.com/*",
  match = {priority=10},
  run = function(data)
    local uri = data.uri
    local content = data.content
    -- Check configuration
    local checkOk, err = pcall(github.checkConfig)
    if not checkOk then
      editor.flashNotification(err, "error")
      return
    end
    local repo, branch, path = github.extractData(uri)
    -- We did find an existing file, let's fetch it to get the SHA
    local oldContent = github.request(github.buildAPIURLWithBranch(repo, branch, path), "GET")
    if not oldContent.ok then
      error("Could not fetch existing file")
    end
    local sha = oldContent.body.sha
    -- Ask for a commit message
    local message = editor.prompt("Commit message:", "Commit")
    -- Push the change
    local resp = github.request(github.buildAPIURL(repo, path), "PUT", {
      message = message,
      committer = {
        name = config.get("github.name"),
        email = config.get("github.email"),
      },
      branch = branch,
      sha = sha,
      content = encoding.base64Encode(content)
    })
    if not resp.ok then
      js.log("Error", resp)
      error("Error, check console")
    end
  end
}

service.define {
  selector = "net.writeURI:github:*",
  match = {priority=10},
  run = function(data)
    local uri = data.uri:sub(#"github:"+1)
    local owner, repo, path = table.unpack(uri:split("/"))
    local repo, branch = table.unpack(repo:split("@"))
    if not branch then
      branch = "main"
    end
    local fullUrl = "https://github.com/" .. owner .. "/" .. repo .. "/blob/" .. branch .. "/" .. path
    -- Redirect to full URI implementation
    net.writeURI(fullUrl, data.content)
  end
}

-- readURI
--   ghr:owner/repo/path (latest)
--   ghr:owner/repo@version/path
service.define {
  selector = "net.readURI:ghr:*",
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
    local res = net.proxyFetch(url)
    if res.status != 200 then
      print("Could not fetch", url, res)
      return
    end
    local releaseInfo = res.body
    version = releaseInfo.tag_name
    local url = "https://github.com/" .. owner .. "/" .. repoClean .. "/releases/download/" .. version .. "/" .. path
    local res = net.proxyFetch(url, {responseEncoding=data.encoding})
    if res.status != 200 then
      print("Failed to fetch", ur, res)
      return nil
    end
    return res.body
  end
}

-- readURI
--   github:owner/repo/path (defaults to "main" branch)
--   github:owner/repo@branch/path
service.define {
  selector = "net.readURI:github:*",
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
    local res = net.proxyFetch(url)
    if res.status != 200 then
      return nil
    end
    return res.body
  end
}

-- readURI
--   https://github.com/owner/repo/blob/branch/path
service.define {
  selector = "net.readURI:https://github.com/*",
  match = {priority=10},
  run = function(data)
    local owner, repo, branch, path = data.uri:match("github%.com/([^/]+)/([^/]+)/[^/]+/([^/]+)/(.+)")
    local url = "https://raw.githubusercontent.com/" .. owner .. "/" .. repo .. "/" .. branch .. "/" .. path
    local res = net.proxyFetch(url)
    if res.status != 200 then
      return nil
    end
    return res.body
  end
}
```

## Gists
```space-lua
local function extractGistId(url)
  if not url:startsWith("https://gist.github.com/") then
    return nil
  end
  return url:match("([^/]+)$")
end

-- Share onboarding
service.define {
  selector = "share:onboard",
  match = {
    name = "Github Gist",
    description = "Share this page as a gist"
  },
  run = function(data)
    local filename = "content.md"
    local text = share.cleanFrontmatter(editor.getText())
    filename = editor.prompt("File name", filename)
    if not filename then
      return
    end
    local resp = github.request("https://api.github.com/gists", "POST", {
      public = true,
      files = {
        [filename] = {
          content = text
        }
      }
    })
    if resp.ok then
      return {
        uri = resp.body.html_url,
        hash = share.contentHash(text),
        mode = "push"
      }
    else
      editor.flashNotification("Error, check console")
      js.log("Error", resp)
    end
  end
}

-- readURI supports
--   https://gist.github.com/user/gistid
service.define {
  selector = "net.readURI:https://gist.github.com/*",
  match = {priority=10},
  run = function(data)
    local gistId = extractGistId(data.uri)
    local resp = net.proxyFetch("https://api.github.com/gists/" .. gistId)
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

-- writeURI
service.define {
  selector = "net.writeURI:https://gist.github.com/*",
  match = {priority=10},
  run = function(data)
    local gistId = extractGistId(data.uri)
    
    -- First fetch the gist to find the file name
    local resp = github.request("https://api.github.com/gists/" .. gistId, "GET")
    if not resp.ok then
      js.log("Error with gist writeURI", resp)
      error("Gist writeURI failed")
    end
    local files = resp.body.files
    local selectedFilename
    -- Find a .md file in the gist to overwrite
    for filename, meta in pairs(files) do
      if filename:endsWith(".md") then
        selectedFilename = filename
        break
      end
    end
    if not selectedFilename then
      error("Could not find markdown file in gist")
    end
    local resp = github.request("https://api.github.com/gists/" .. gistId, "PATCH", {
      public = true,
      files = {
        [selectedFilename] = {
          content = data.content
        }
      }
    })
    if not resp.ok then
      js.log("Error", resp)
      error("Error publishing gist, check console")
    end
  end
}
```
