---
description: Integration with Github repositories and gists.
tags: meta
---
Support for [SilverBullet Share](https://docs.silverbullet.md/Share) for:

* Github repo files
* Github gists

As well as [URI](https://docs.silverbullet.md/URI) support (both read and write) for the following schemes:
* `https://github.com/username/repo/blob/branch/path`
* `https://gist.github.com/username/gist-id`
* `github:username/repo@branch/path`
* `github:username/repo/path` (defaults to `main` branch)
* `ghr:username/repo@version/path` (github release support)

# Configuration
If you only want to read public content from Github URLs, no configuration is required. Reads never ask you to sign in; if you are already connected (or have a token configured) it is used, so private repos you have access to can be read too. When GitHub rejects that token (expired or revoked), the read is retried without it.

To _write_ to Github repos and gists you need to connect to Github. This happens automatically the first time you share or access something that needs it: a device code is shown, which you enter on github.com to authorize SilverBullet. The resulting token is stored on this device only (see {[Credentials: List]}) and can be cleared with {[Credentials: Clear]}.

Optionally, you can use a [personal Github token](https://github.com/settings/personal-access-tokens) (with repo and gists permissions) instead. Configure your token somewhere in Space Lua (use a `space-lua` block), ideally a `SECRETS` page. When set (and you have not connected through the device flow), it is used without asking you to sign in.

```lua
config.set("github.token", "your token")
```

To use your own Github OAuth app for the sign-in instead of the default one, set its client ID:

```lua
config.set("github.clientId", "your client id")
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

config.define("github", {
  description = "GitHub integration settings",
  type = "object",
  properties = {
    name = {
      type = "string",
      description = "Author name for Git commits",
      ui = { category = "GitHub", label = "Author name", priority = 3 },
    },
    email = {
      type = "string",
      description = "Author email for Git commits",
      ui = { category = "GitHub", label = "Author email", priority = 2 },
    },
    clientId = {
      type = "string",
      description = "Client ID of a GitHub OAuth app (device flow), overrides the default",
      ui = { category = "GitHub", label = "OAuth client ID", priority = 0 },
    },
    token = {
      type = "string",
      description = "Personal access token for GitHub API (optional alternative to signing in)",
      ui = { category = "GitHub", label = "GitHub token", priority = 1, inputType = "password" },
    },
  },
  additionalProperties = false,
})
```

## Auth provider
```space-lua
-- priority: 5
-- GitHub tokens do not expire, so there is no refresh
auth.defineProvider {
  id = "github",
  connect = function()
    local token = oauth.deviceFlow {
      deviceCodeUrl = "https://github.com/login/device/code",
      tokenUrl = "https://github.com/login/oauth/access_token",
      clientId = config.get("github.clientId") or "Ov23liZmRh8sR6UeL8fQ",
      scope = "repo gist",
    }
    return {access_token = token.access_token}
  end,
  configured = function()
    local token = config.get("github.token")
    return token and {access_token = token}
  end,
  -- Only Authorization: raw and download hosts reject other headers
  headers = function(cred)
    return {Authorization = "Bearer " .. cred.access_token}
  end,
}
```

## Github Repo Files
```space-lua
-- priority: 10
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

-- "https://github.com/u/r/blob/main/a/B.md" or "github:u/r@main/a/B.md" -> "a/B.md"
local function filePath(uri)
  if uri:startsWith("github:") then
    return uri:match("^github:[^/]+/[^/]+/(.+)$")
  end
  local _, _, path = github.extractData(uri)
  return path
end

-- GitHub's heading anchors: lower-case, spaces to "-", other punctuation gone
local function slug(anchor)
  return (anchor:lower():gsub("%p", function(c)
    if c == "-" or c == "_" then
      return c
    end
    return ""
  end):gsub(" ", "-"))
end

-- Segments are encoded, but not again when the URI already is
local function encodePath(path)
  local segments = {}
  for _, segment in ipairs(path:split("/")) do
    local ok, decoded = pcall(encoding.urlDecode, segment)
    table.insert(segments, encoding.urlEncode(ok and decoded or segment))
  end
  return table.concat(segments, "/")
end

-- Path from the directory of file "from" to file "to", both repo-relative
local function relativePath(from, to)
  local fromDirs = from:split("/")
  table.remove(fromDirs)
  local toParts = to:split("/")
  local common = 0
  while common < #fromDirs and common < #toParts - 1
      and fromDirs[common + 1] == toParts[common + 1] do
    common = common + 1
  end
  local parts = {}
  for _ = common + 1, #fromDirs do
    table.insert(parts, "..")
  end
  for i = common + 1, #toParts do
    table.insert(parts, toParts[i])
  end
  return table.concat(parts, "/")
end

-- Descriptor for share.transform: relative Markdown links between shared files
local function githubTarget(data)
  return {
    kind = "github",
    defaults = {links = true, comments = true, frontmatter = true, bake = true},
    link = function(l)
      local target = ""
      if l.toUri != nil and l.toUri != l.fromUri then
        local from, to = filePath(l.fromUri), filePath(l.toUri)
        if from == nil or to == nil then
          return l.text
        end
        target = encodePath(relativePath(from, to))
        if not target:endsWith(".md") then
          target = target .. ".md"
        end
      end
      if l.anchor != nil then
        target = target .. "#" .. slug(l.anchor)
      end
      if target == "" then
        return l.text
      end
      return "[" .. l.text .. "](" .. target .. ")"
    end,
  }
end

for _, selector in ipairs({"share:target:https://github.com/*", "share:target:github:*"}) do
  service.define {
    selector = selector,
    match = {priority = 10},
    run = githubTarget,
  }
end

local apiHeaders = {Accept = "application/vnd.github+json"}

-- An API request that signs in when needed
function github.request(url, method, body)
  return auth.fetch("github", url, {
    method = method,
    headers = apiHeaders,
    body = body,
  }, true)
end

function github.checkConfig()
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
    -- Nothing is uploaded here: the first share creates the file
    return {
      uri = github.buildURI(repo, branch, path),
      mode = "push"
    }
  end
}

-- writeURI support
service.define {
  selector = "net.writeURI:https://github.com/*",
  match = {priority=10},
  run = function(data)
    local uri = data.uri
    local content = data.content
    local checkOk, err = pcall(github.checkConfig)
    if not checkOk then
      editor.flashNotification(err, "error")
      return
    end
    local repo, branch, path = github.extractData(uri)
    -- An existing file needs its SHA to be replaced, a missing one is created
    local oldContent = github.request(github.buildAPIURLWithBranch(repo, branch, path), "GET")
    local sha
    if oldContent.ok then
      sha = oldContent.body.sha
    elseif oldContent.status != 404 then
      error("Could not fetch existing file")
    end
    local message = editor.prompt("Commit message:", "Commit")
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
    local res = auth.fetch("github", url, {headers = apiHeaders})
    if res.status != 200 then
      print("Could not fetch", url, res)
      return
    end
    local releaseInfo = res.body
    version = releaseInfo.tag_name
    local url = "https://github.com/" .. owner .. "/" .. repoClean .. "/releases/download/" .. version .. "/" .. path
    local res = auth.fetch("github", url, {responseEncoding = data.encoding})
    if res.status != 200 then
      print("Failed to fetch", url, res)
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
    local res = auth.fetch("github", url)
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
    local res = auth.fetch("github", url)
    if res.status != 200 then
      return nil
    end
    return res.body
  end
}
```

## Gists
```space-lua
-- priority: 10
local function extractGistId(url)
  if not url:startsWith("https://gist.github.com/") then
    return nil
  end
  return url:match("([^/]+)$")
end

-- Multi-file gists are not handled yet: links become their text
service.define {
  selector = "share:target:https://gist.github.com/*",
  match = {priority = 10},
  run = function(data)
    return {
      kind = "gist",
      defaults = {links = true, comments = true, frontmatter = true, bake = true},
      link = function(l)
        return l.text
      end,
    }
  end,
}

service.define {
  selector = "share:onboard",
  match = {
    name = "Github Gist",
    description = "Share this page as a gist"
  },
  run = function(data)
    local filename = editor.prompt("File name", "content.md")
    if not filename then
      return
    end
    local resp = github.request("https://api.github.com/gists", "POST", {
      public = true,
      files = {
        [filename] = {
          content = data.content
        }
      }
    })
    if resp.ok then
      return {
        uri = resp.body.html_url,
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
    local resp = auth.fetch("github", "https://api.github.com/gists/" .. gistId, {
      headers = {Accept = "application/vnd.github+json"},
    })
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
