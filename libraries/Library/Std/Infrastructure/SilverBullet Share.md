---
description: Share pages to another SilverBullet space.
tags: meta
---
Lets [SilverBullet Share](https://docs.silverbullet.md/Share) publish pages to (and sync them with) a page in another SilverBullet space (local or remote).

# Connecting
Run `Share: Page` and pick **SilverBullet space**. The first time, choose `Another space…` and enter the URL of the other space (e.g. `https://example.com/notes`). SilverBullet checks that it really is a SilverBullet space, then signs you in with a device code: open the link that is shown, log in to the other space and approve the request. Finally enter the page path to share to; it defaults to the name of the current page.

Spaces you have shared to are remembered in this space's configuration (`share.silverbullet.spaces` in [[CONFIG]]), most recent first, so they are offered again next time, on every device. The sign-in tokens are not: they stay in this browser (see {[Credentials: List]} and {[Credentials: Clear]}). On another device you are asked to sign in again the first time you share to that space.

# Implementation
```space-lua
-- priority: 5
sbShare = {}

-- ETag last seen per share URI, sent as If-Match on the next conditional write
local etags = {}

local clientId = "silverbullet-share"

config.define("share.silverbullet.spaces", {
  type = "array",
  items = { type = "string" },
  description = "SilverBullet spaces shared to before, most recently used first",
})

-- "https://h/notes/" -> "https://h/notes"
local function normalize(url)
  return (url:trim():gsub("/+$", ""))
end

-- encodeURIComponent, except that "/" is kept (SilverBullet's encodePageURI)
local function encodePageURI(s)
  return (encoding.urlEncode(s):gsub("%%2F", "/"))
end

function sbShare.pageUri(spaceUrl, pageName)
  return normalize(spaceUrl) .. "/" .. encodePageURI(pageName)
end

-- Spaces from space config plus those with a credential on this client
local function knownSpaces()
  local spaces = {}
  local seen = {}
  local function add(url)
    url = normalize(url)
    if not seen[url] then
      seen[url] = true
      table.insert(spaces, url)
    end
  end
  for _, url in ipairs(config.get("share.silverbullet.spaces") or {}) do
    add(url)
  end
  for _, key in ipairs(auth.listKeys("sb:")) do
    local _, target = auth.splitKey(key)
    add(target)
  end
  return spaces
end

-- Returns the space URL and page name of a share URI, or nil
function sbShare.resolve(uri)
  local best = nil
  for _, space in ipairs(knownSpaces()) do
    local prefix = space .. "/"
    if #uri > #prefix and uri:sub(1, #prefix) == prefix
        and (best == nil or #space > #best) then
      best = space
    end
  end
  if not best then
    return nil
  end
  return best, encoding.urlDecode(uri:sub(#best + 2))
end

-- Prefixes found not to be a SilverBullet space this session
local notASpace = {}

local function credentialKey(spaceUrl)
  return "sb:" .. spaceUrl
end

-- Probes <prefix>/.ping for each path prefix of url, longest first. Only a
-- SilverBullet server answers it with an X-Server-Version header.
function sbShare.findSpaceRoot(url)
  url = normalize((url:gsub("[?#].*$", "")))
  local origin, path = url:match("^(https?://[^/]+)(.*)$")
  if not origin then
    return nil
  end
  local segments = path:split("/")
  local parts = {}
  for _, segment in ipairs(segments) do
    if segment != "" then
      table.insert(parts, segment)
    end
  end
  for n = #parts, 0, -1 do
    local prefix = origin
    for i = 1, n do
      prefix = prefix .. "/" .. parts[i]
    end
    if not notASpace[prefix] then
      -- A network failure counts as "not a space" (but is not remembered)
      local ok, resp = pcall(auth.fetch, credentialKey(prefix),
        prefix .. "/.ping", {method = "GET"})
      if ok and resp then
        if resp.status == 200 and resp.headers
            and resp.headers["x-server-version"] then
          return prefix
        end
        -- Only definitive answers are remembered, not e.g. 401, 429 or 5xx
        if resp.status == 200 or resp.status == 404 or resp.status == 405 then
          notASpace[prefix] = true
        end
      end
    end
  end
  return nil
end

-- Descriptor for share.transform: links stay wiki links between shared pages
service.define {
  selector = "share:target:http*",
  match = function(data)
    if sbShare.resolve(data.uri) then
      return {priority = 10}
    end
    return nil
  end,
  run = function(data)
    return {
      kind = "silverbullet",
      defaults = {links = true, comments = true, frontmatter = false, bake = false},
      link = function(l)
        local out = ""
        if l.toUri != nil and l.toUri != l.fromUri then
          local _, page = sbShare.resolve(l.toUri)
          if page == nil then
            return l.text
          end
          out = page
        end
        if l.anchor != nil then
          out = out .. "#" .. l.anchor
        end
        if out == "" then
          return l.text
        end
        if l.alias != nil then
          out = out .. "|" .. l.alias
        end
        return "[[" .. out .. "]]"
      end,
    }
  end,
}

local function fsUrl(spaceUrl, uri)
  local page = encoding.urlDecode(uri:sub(#spaceUrl + 2))
  return spaceUrl .. "/.fs/" .. encodePageURI(page) .. ".md"
end

-- Reads a page, nil when it doesn't exist. Never signs in.
local function readPage(spaceUrl, uri)
  local resp = auth.fetch(credentialKey(spaceUrl), fsUrl(spaceUrl, uri), {
    method = "GET",
    responseEncoding = "text/markdown",
  })
  if resp.status == 404 then
    return nil
  elseif resp.status == 401 then
    error("Not connected to " .. spaceUrl .. ": share a page to it in push or sync mode to sign in")
  elseif resp.status != 200 then
    error("SilverBullet share: read failed (" .. resp.status .. ")")
  end
  etags[uri] = resp.headers and resp.headers.etag
  return resp.body
end

local function transportMatch(data)
  if sbShare.resolve(data.uri) then
    return {priority = 20}
  end
  return nil
end

service.define {
  selector = "net.readURI:http*",
  match = transportMatch,
  run = function(data)
    return readPage(sbShare.resolve(data.uri), data.uri)
  end,
}

service.define {
  selector = "net.writeURI:http*",
  match = transportMatch,
  run = function(data)
    local spaceUrl = sbShare.resolve(data.uri)
    local headers = {}
    if data.conditional and etags[data.uri] then
      headers["If-Match"] = etags[data.uri]
    end
    local resp = auth.fetch(credentialKey(spaceUrl), fsUrl(spaceUrl, data.uri), {
      method = "PUT",
      headers = headers,
      body = data.content,
    }, true)
    if resp.status == 412 then
      return {conflict = true}
    end
    if resp.status < 200 or resp.status >= 300 then
      error("SilverBullet share: write failed (" .. resp.status .. ")")
    end
    etags[data.uri] = resp.headers and resp.headers.etag
  end,
}

-- Makes sure this client has a credential (may run the device flow)
local function signIn(spaceUrl)
  auth.headers(credentialKey(spaceUrl))
end

-- Moves (or adds) root to the front of share.silverbullet.spaces
local function rememberSpace(root)
  root = normalize(root)
  local current = config.get("share.silverbullet.spaces") or {}
  local list = {root}
  for _, url in ipairs(current) do
    url = normalize(url)
    if url != root then
      table.insert(list, url)
    end
  end
  if table.concat(list, "\n") != table.concat(current, "\n") then
    system.invokeFunction("configuration-manager.setConfigValue",
      "share.silverbullet.spaces", list)
  end
end

local function tokenCredential(token, target, previous)
  return {
    access_token = token.access_token,
    refresh_token = token.refresh_token or (previous and previous.refresh_token),
    expires_at = token.expires_in and (os.time() * 1000 + token.expires_in * 1000),
    username = token.username or (previous and previous.username),
    space = target,
  }
end

auth.defineProvider {
  id = "sb",
  connect = function(target)
    local ok, result = pcall(oauth.deviceFlow, {
      deviceCodeUrl = target .. "/.auth/device/code",
      tokenUrl = target .. "/.auth/token",
      clientId = clientId,
    })
    if not ok then
      if tostring(result):find("unauthorized_client", 1, true) then
        error("Remote server too old for sharing (needs a newer SilverBullet)")
      end
      error(result)
    end
    return tokenCredential(result, target)
  end,
  refresh = function(cred)
    local resp = net.proxyFetch(cred.space .. "/.auth/token", {
      method = "POST",
      headers = {["Content-Type"] = "application/x-www-form-urlencoded"},
      body = "grant_type=refresh_token&refresh_token="
        .. encoding.urlEncode(cred.refresh_token)
        .. "&client_id=" .. clientId,
    })
    if resp.status != 200 then
      error("SilverBullet share: token refresh failed (" .. resp.status .. ")")
    end
    return tokenCredential(resp.body, cred.space, cred)
  end,
  headers = function(cred)
    return {Authorization = "Bearer " .. cred.access_token}
  end,
}

local anotherSpace = "Another space…"

service.define {
  selector = "share:onboard",
  match = {
    name = "SilverBullet space",
    description = "Share this page to a page in another SilverBullet space",
  },
  run = function(data)
    local options = {}
    for _, url in ipairs(config.get("share.silverbullet.spaces") or {}) do
      table.insert(options, {name = normalize(url)})
    end
    table.insert(options, {name = anotherSpace})
    local picked = editor.filterBox("SilverBullet space", options)
    if not picked then
      return
    end
    local root
    if picked.name == anotherSpace then
      local url = editor.prompt("Space URL")
      if not url or url:trim() == "" then
        return
      end
      root = sbShare.findSpaceRoot(url)
      if not root then
        error("Not a SilverBullet space: " .. normalize(url))
      end
    else
      root = picked.name
    end
    signIn(root)
    local path = editor.prompt("Page path in that space", data.name)
    if not path then
      return
    end
    -- "/Shared/Page.md" -> "Shared/Page"
    path = path:trim():gsub("^/+", ""):gsub("%.md$", "")
    if path == "" then
      return
    end
    local uri = sbShare.pageUri(root, path)
    if readPage(root, uri) and not editor.confirm(path .. " already exists in "
        .. root .. ". Overwrite it?") then
      return
    end
    rememberSpace(root)
    -- The push that follows uploads the page
    return {uri = uri, mode = "push"}
  end,
}

service.define {
  selector = "share:ensure",
  match = function(data)
    local uri = data.uri or ""
    if not uri:match("^https?://[^/]+") then
      return nil
    end
    if not sbShare.resolve(uri) then
      -- Another provider writes this URI (e.g. GitHub)
      for _, m in ipairs(service.discover("net.writeURI:" .. uri, {uri = uri}) or {}) do
        if (m.priority or 0) > 0 then
          return nil
        end
      end
    end
    return {priority = 10}
  end,
  run = function(data)
    local root = sbShare.resolve(data.uri)
    local known = root != nil
    local question
    if known then
      -- An expired credential that refreshes needs no sign-in
      if auth.optionalHeaders(credentialKey(root)) then
        return true
      end
      question = "Sign in to " .. root .. "?"
    else
      root = sbShare.findSpaceRoot(data.uri)
      if not root then
        return false
      end
      -- Without a connection, reads would go to the generic https: reader,
      -- which returns the remote's HTML (or sign-in page) instead of the page
      question = "Connect to " .. root .. "?"
    end
    if not editor.confirm(question) then
      error("Not connected to " .. root)
    end
    local ok, err = pcall(signIn, root)
    if not ok then
      error("Not connected to " .. root .. ": " .. tostring(err))
    end
    if not known then
      rememberSpace(root)
    end
    return true
  end,
}
```
