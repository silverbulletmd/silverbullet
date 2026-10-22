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
* `https://gist.github.com/username/gist-id/file` (one file of a gist, as collections use them)
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
-- "github:owner/repo[@ref]/path" or "https://github.com/owner/repo/blob/ref/path"
-- -> "owner/repo", ref (nil when not given), path as written ("" for a root).
-- nil when it is neither.
local function parseRepoURI(uri)
  if uri:startsWith("github:") then
    local owner, name, path = uri:match("^github:([^/]+)/([^/]+)/?(.*)$")
    if not owner then
      return nil
    end
    local name, ref = table.unpack(name:split("@"))
    return owner .. "/" .. name, ref, path
  end
  local repo, ref, path = uri:match("github%.com/([^/]+/[^/]+)/[^/]+/([^/]+)/?(.*)$")
  if repo then
    return repo, ref, path
  end
end

-- Public, kept for Space Lua that calls it: (owner/repo, branch, path) of an
-- https://github.com/... file URL, nil for anything else
function github.extractData(url)
  if url == nil or url:startsWith("github:") then
    return nil
  end
  local repo, ref, path = parseRepoURI(url)
  if repo and path != "" then
    return repo, ref, path
  end
end

-- Like parseRepoURI, for a URI of a file: an error for a root or other URI
local function parseFileURI(uri)
  local repo, ref, path = parseRepoURI(uri)
  if not repo or path == "" then
    error("Expected owner/repo/path, got " .. uri)
  end
  return repo, ref, path
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
  local _, _, path = parseRepoURI(uri)
  if path != "" then
    return path
  end
end

-- GitHub's heading anchors: lower-case, spaces to "-", punctuation and
-- symbols gone (also outside ASCII: quotes, dashes, emoji), letters kept
local function slug(anchor)
  local s = anchor:lower():gsub("%p", function(c)
    if c == "-" or c == "_" then
      return c
    end
    return ""
  end)
  s = s:gsub("[\u{00A1}-\u{00A9}\u{00AB}-\u{00B1}\u{00B4}\u{00B6}-\u{00B8}\u{00BB}\u{00BF}\u{00D7}\u{00F7}\u{2010}-\u{2BFF}\u{2E00}-\u{2E7F}\u{3000}-\u{303F}\u{FE00}-\u{FE0F}\u{FF01}-\u{FF0F}\u{D800}-\u{DFFF}]", "")
  return (s:gsub(" ", "-"))
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
    defaults = {links = true, comments = true, bake = true},
    webUrl = function(uri)
      if not uri:startsWith("github:") then
        return uri
      end
      local repo, ref, path = parseFileURI(uri)
      return github.buildURI(repo, ref or "main", path)
    end,
    memberUri = function(root, path)
      return root .. "/" .. encodePath(path) .. ".md"
    end,
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

-- The body of a successful response (nil for a 404 when missingOk). Any
-- other status is an error, so a failed read never looks like a missing file.
function github.responseBody(res, what, missingOk)
  if missingOk and res.status == 404 then
    return nil
  end
  if not res.ok then
    local reason = type(res.body) == "table" and res.body.message
    error("GitHub refused " .. what .. ": HTTP " .. res.status
      .. (reason and (": " .. reason) or ""))
  end
  return res.body
end
local responseBody = github.responseBody

local function readBody(res, url)
  return responseBody(res, "reading " .. url, true)
end

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
    local repo, branch, path = parseFileURI(uri)
    -- An existing file needs its SHA to be replaced, a missing one is created
    local oldContent = github.request(github.buildAPIURLWithBranch(repo, branch, path), "GET")
    local sha
    if oldContent.ok then
      sha = oldContent.body.sha
    elseif oldContent.status != 404 then
      error("Could not check " .. path .. " on GitHub: HTTP " .. oldContent.status)
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
    responseBody(resp, "the write")
  end
}

service.define {
  selector = "net.writeURI:github:*",
  match = {priority=10},
  run = function(data)
    local repo, ref, path = parseFileURI(data.uri)
    return net.writeURI(github.buildURI(repo, ref or "main", path), data.content)
  end
}

-- A github: or https://github.com/ root (a directory, or the repo itself) ->
-- "owner/repo", ref, directory path decoded ("" for the repo root)
local function splitRoot(root)
  local repo, ref, dir = parseRepoURI(root)
  if not repo then
    error("Expected github:owner/repo or https://github.com/owner/repo/blob/branch, got " .. root)
  end
  return repo, ref or "main", encoding.urlDecode(dir)
end

local function repoAPIURL(repo, path)
  return "https://api.github.com/repos/" .. repo .. "/" .. path
end

-- The path in the repo of a file URI under root, decoded
local function repoPath(uri)
  return encoding.urlDecode(filePath(uri))
end

-- The Markdown files under root, as memberUri builds them, with their blob
-- SHAs. Signs in only with data.signIn (a publish; check never prompts).
local function listFiles(data)
  local root = data.uri
  local repo, ref, dir = splitRoot(root)
  local function get(path)
    local url = repoAPIURL(repo, path)
    if data.signIn then
      return github.request(url, "GET")
    end
    return auth.fetch("github", url, {headers = apiHeaders})
  end
  -- Only the root's subtree, so entry paths are relative to it
  local treeish = dir == "" and ref or (ref .. ":" .. encodePath(dir))
  local resp = get("git/trees/" .. treeish .. "?recursive=1")
  -- A folder not created yet, on a branch that exists
  if resp.status == 404 and dir != "" and get("git/ref/heads/" .. ref).ok then
    return {}
  end
  if resp.status == 404 then
    error("GitHub: " .. repo .. "@" .. ref .. " not found (or not signed in to GitHub)")
  end
  local body = responseBody(resp, "the listing")
  if body.truncated then
    error("GitHub: too many files under " .. root .. " to list")
  end
  local entries = {}
  for _, entry in ipairs(body.tree or {}) do
    if entry.type == "blob" and entry.path:endsWith(".md") then
      table.insert(entries, {uri = root .. "/" .. encodePath(entry.path), hash = entry.sha})
    end
  end
  return entries
end

-- JSON by hand: a nil sha (deleting the file) would vanish from a Lua table
local function treeBody(baseTree, writes, deletes)
  local entries = {}
  for _, w in ipairs(writes) do
    table.insert(entries, '{"path":' .. js.stringify(repoPath(w.uri))
      .. ',"mode":"100644","type":"blob","content":' .. js.stringify(w.content) .. "}")
  end
  for _, uri in ipairs(deletes) do
    table.insert(entries, '{"path":' .. js.stringify(repoPath(uri))
      .. ',"mode":"100644","type":"blob","sha":null}')
  end
  return '{"base_tree":' .. js.stringify(baseTree) .. ',"tree":['
    .. table.concat(entries, ",") .. "]}"
end

-- All writes and deletes of a collection publish as one commit
local function writeBatch(data)
  github.checkConfig()
  local message = editor.prompt("Commit message:", "Publish " .. data.root)
  if not message or message:trim() == "" then
    return {cancelled = true}
  end
  local repo, ref = splitRoot(data.root)
  local head = responseBody(github.request(
    repoAPIURL(repo, "git/ref/heads/" .. ref), "GET"), "the branch").object.sha
  local baseTree = responseBody(github.request(
    repoAPIURL(repo, "git/commits/" .. head), "GET"), "the commit").tree.sha
  local tree = responseBody(github.request(repoAPIURL(repo, "git/trees"), "POST",
    treeBody(baseTree, data.writes or {}, data.deletes or {})), "the tree").sha
  local person = {name = config.get("github.name"), email = config.get("github.email")}
  local commit = responseBody(github.request(repoAPIURL(repo, "git/commits"), "POST", {
    message = message,
    tree = tree,
    parents = {head},
    author = person,
    committer = person,
  }), "the commit").sha
  local resp = github.request(repoAPIURL(repo, "git/refs/heads/" .. ref), "PATCH",
    {sha = commit})
  if resp.status == 422 then
    error("The branch moved while publishing; publish again")
  end
  responseBody(resp, "the branch update")
end

for _, scheme in ipairs({"github:", "https://github.com/"}) do
  service.define {
    selector = "net.listURI:" .. scheme .. "*",
    match = {priority = 10},
    run = listFiles,
  }
  service.define {
    selector = "share:writeBatch:" .. scheme .. "*",
    match = {priority = 10},
    run = writeBatch,
  }
end

-- readURI
--   ghr:owner/repo/path (latest)
--   ghr:owner/repo@version/path
service.define {
  selector = "net.readURI:ghr:*",
  match = { priority=10 },
  run = function(data)
    -- Same shape as github:, with a release version for the ref
    local repo, version, path = parseFileURI("github:" .. data.uri:sub(#"ghr:"+1))
    local url
    if not version or version == "latest" then
      url = repoAPIURL(repo, "releases/latest")
    else
      url = repoAPIURL(repo, "releases/tags/" .. version)
    end
    local releaseInfo = readBody(auth.fetch("github", url, {headers = apiHeaders}), url)
    if releaseInfo == nil then
      return nil
    end
    local url = "https://github.com/" .. repo .. "/releases/download/" .. releaseInfo.tag_name .. "/" .. path
    return readBody(auth.fetch("github", url, {responseEncoding = data.encoding}), url)
  end
}

-- readURI
--   github:owner/repo/path (defaults to "main" branch)
--   github:owner/repo@branch/path
service.define {
  selector = "net.readURI:github:*",
  match = { priority=10 },
  run = function(data)
    local repo, ref, path = parseFileURI(data.uri)
    local url = "https://raw.githubusercontent.com/" .. repo .. "/" .. (ref or "main") .. "/" .. path
    return readBody(auth.fetch("github", url), url)
  end
}

-- readURI
--   https://github.com/owner/repo/blob/branch/path
service.define {
  selector = "net.readURI:https://github.com/*",
  match = {priority=10},
  run = function(data)
    local repo, ref, path = parseFileURI(data.uri)
    local url = "https://raw.githubusercontent.com/" .. repo .. "/" .. ref .. "/" .. path
    return readBody(auth.fetch("github", url), url)
  end
}
```

## Gists
```space-lua
-- priority: 10
-- https://gist.github.com/[user/]id[/file] -> user (nil when not given), id,
-- file (nil for the gist itself: a single-page share's first .md file). File
-- names hold a "." and ids and user names never do.
local function splitGist(uri)
  local segments = uri:sub(#"https://gist.github.com/" + 1):gsub("/+$", ""):split("/")
  if #segments >= 3 then
    return segments[1], segments[2], segments[3]
  elseif #segments == 2 and segments[2]:find(".", 1, true) then
    return nil, segments[1], segments[2]
  elseif #segments == 2 then
    return segments[1], segments[2]
  end
  return nil, segments[1]
end

local gistHeaders = {Accept = "application/vnd.github+json"}

local function gistAPIURL(id)
  return "https://api.github.com/gists/" .. id
end

-- The gist's page, at the file's anchor for a file URI
local function gistWebUrl(uri)
  local user, id, file = splitGist(uri)
  local url = "https://gist.github.com/" .. (user and (user .. "/") or "") .. id
  if file then
    url = url .. "#file-" .. file:lower():gsub("[^%w_-]", "-")
  end
  return url
end

-- One file per member, named after its path
service.define {
  selector = "share:target:https://gist.github.com/*",
  match = {priority = 10},
  run = function()
    return {
      kind = "gist",
      defaults = {links = true, comments = true, bake = true},
      webUrl = gistWebUrl,
      memberUri = function(root, path)
        return root .. "/" .. (path:gsub("/", "-")) .. ".md"
      end,
      link = function(l)
        if l.toUri == nil or l.toUri == l.fromUri then
          return l.text
        end
        local _, fromId = splitGist(l.fromUri)
        local _, toId, toFile = splitGist(l.toUri)
        if toFile == nil or toId != fromId then
          return l.text
        end
        return "[" .. l.text .. "](" .. gistWebUrl(l.toUri) .. ")"
      end,
    }
  end,
}

-- The Markdown files of the gist, as memberUri builds them. Only names:
-- large files come without their content. Signs in only with data.signIn (a publish).
service.define {
  selector = "net.listURI:https://gist.github.com/*",
  match = {priority = 10},
  run = function(data)
    local _, id = splitGist(data.uri)
    local url = gistAPIURL(id)
    local resp
    if data.signIn then
      resp = github.request(url, "GET")
    else
      resp = auth.fetch("github", url, {headers = gistHeaders})
    end
    if resp.status == 404 then
      error("GitHub: gist " .. id .. " not found (or not signed in to GitHub)")
    end
    local gist = github.responseBody(resp, "the gist listing")
    if gist.truncated then
      error("GitHub: too many files in " .. data.uri .. " to list")
    end
    local names = {}
    for name in pairs(gist.files or {}) do
      if name:endsWith(".md") then
        table.insert(names, name)
      end
    end
    table.sort(names)
    local entries = {}
    for _, name in ipairs(names) do
      table.insert(entries, {uri = data.uri .. "/" .. name})
    end
    return entries
  end,
}

-- PATCH with the file as JSON null, which a Lua table can't hold
service.define {
  selector = "net.deleteURI:https://gist.github.com/*",
  match = {priority = 10},
  run = function(data)
    local _, id, file = splitGist(data.uri)
    if not file then
      error("Not a gist file: " .. data.uri)
    end
    local resp = github.request(gistAPIURL(id), "PATCH",
      '{"files":{' .. js.stringify(file) .. ":null}}")
    github.responseBody(resp, "the delete", true)
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
--   https://gist.github.com/user/gistid (the first file with content)
--   https://gist.github.com/user/gistid/file
service.define {
  selector = "net.readURI:https://gist.github.com/*",
  match = {priority=10},
  run = function(data)
    local _, gistId, file = splitGist(data.uri)
    local resp = auth.fetch("github", gistAPIURL(gistId), {headers = gistHeaders})
    if file then
      local gist = github.responseBody(resp, "reading " .. data.uri, true)
      local meta = gist and gist.files and gist.files[file]
      if meta == nil then
        return nil
      end
      -- Large files come truncated or without content
      if meta.truncated or meta.content == nil then
        return github.responseBody(auth.fetch("github", meta.raw_url),
          "reading " .. data.uri)
      end
      return meta.content
    end
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
    local _, gistId, file = splitGist(data.uri)
    if file then
      github.responseBody(github.request(gistAPIURL(gistId), "PATCH", {
        files = {[file] = {content = data.content}},
      }), "the gist write")
      return
    end
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
