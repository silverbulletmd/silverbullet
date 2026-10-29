---
description: Client-side credential store and pluggable authentication providers.
tags: meta
---
Stores credentials (tokens) for remote services on this device and hands out the HTTP headers needed to talk to them.

Credentials are kept in the client-side store, so they are never synced to the server or to other devices. When client encryption is enabled they are stored encrypted like the rest of the local data.

Two commands manage them:

* `Credentials: List`: show the stored credentials
* `Credentials: Clear`: clear a credential (or all of them), so you are asked to sign in again the next time it is needed

# For library authors
Credential keys are `provider` or `provider:target`, e.g. `github` or `sb:https://example.com/notes`.

Register a provider:

```lua
auth.defineProvider {
  id = "github",
  -- Sign in, returns the credential (a table, e.g. {access_token = "..."})
  connect = function(target) ... end,
  -- Optional: renew an expired credential
  refresh = function(cred) ... end,
  -- Turn a credential into HTTP headers
  headers = function(cred) return {Authorization = "Bearer " .. cred.access_token} end,
  -- Optional: defaults to `cred.expires_at` (ms) being within a minute of now
  expired = function(cred) ... end,
  -- Optional: a credential from configuration (e.g. a personal token), used
  -- when none is stored; it is never stored and nothing signs in while it is set
  configured = function(target) ... end,
}
```

Then call `auth.fetch("github", url, options, true)`, which makes the request with the credential's headers. With `true` as the last argument it signs in when there is no credential, and when the request is rejected (401) it drops the stored credential and signs in again, once. Without it, it never signs in: it sends a stored (and if needed refreshed) credential if there is one, and repeats a rejected request without it, so public content stays readable.

`auth.headers("github")` and `auth.optionalHeaders("github")` return just the headers, signing in when needed or never, respectively.

Other functions: `auth.getCredential(key)`, `auth.setCredential(key, value)`, `auth.deleteCredential(key)`, `auth.listKeys(prefix)`, `auth.splitKey(key)` and `auth.list()`.

# Implementation
```space-lua
-- priority: 10
auth = {}

-- All credentials, by key, under one client store key
local storeKey = "credentials"

local function readAll()
  return clientStore.get(storeKey) or {}
end

function auth.listKeys(prefix)
  local keys = {}
  for key in pairs(readAll()) do
    if not prefix or key:startsWith(prefix) then
      table.insert(keys, key)
    end
  end
  table.sort(keys)
  return keys
end

function auth.getCredential(key)
  return readAll()[key]
end

-- Returns the stored credential: value plus `provider` and `createdAt`
function auth.setCredential(key, value)
  local cred = {}
  for k, v in pairs(value) do
    cred[k] = v
  end
  cred.provider = (auth.splitKey(key))
  cred.createdAt = os.time() * 1000
  local all = readAll()
  all[key] = cred
  clientStore.set(storeKey, all)
  return cred
end

-- Rebuilt rather than set to nil: the store would keep the key (as null)
function auth.deleteCredential(key)
  local rest = {}
  for k, cred in pairs(readAll()) do
    if k != key then
      rest[k] = cred
    end
  end
  clientStore.set(storeKey, rest)
end

-- "github" -> "github", nil; "sb:https://h/notes" -> "sb", "https://h/notes"
function auth.splitKey(key)
  local colon = key:find(":", 1, true)
  if not colon then
    return key, nil
  end
  return key:sub(1, colon - 1), key:sub(colon + 1)
end

local providers = {}

function auth.defineProvider(p)
  providers[p.id] = p
end

local function expired(p, cred)
  if p.expired then
    return p.expired(cred)
  end
  return cred.expires_at != nil and cred.expires_at < os.time() * 1000 + 60000
end

-- The provider and target of a key, and the credential to use: the stored
-- one (renewed when expired), else the provider's configured one; nil when
-- there is neither
local function usableCredential(key)
  local id, target = auth.splitKey(key)
  local p = providers[id]
  if not p then
    error("No auth provider: " .. id)
  end
  local cred = auth.getCredential(key)
  if cred and expired(p, cred) then
    local ok, refreshed = false, nil
    if p.refresh then
      ok, refreshed = pcall(p.refresh, cred)
    end
    -- Only stored once refreshing succeeded
    if ok and refreshed then
      cred = auth.setCredential(key, refreshed)
    else
      cred = nil
    end
  end
  if not cred and p.configured then
    cred = p.configured(target)
  end
  return p, target, cred
end

function auth.headers(key)
  local p, target, cred = usableCredential(key)
  if not cred then
    -- Only stored once connecting succeeded
    cred = auth.setCredential(key, p.connect(target))
  end
  return p.headers(cred)
end

-- Like auth.headers, but never signs in: nil without a usable credential
function auth.optionalHeaders(key)
  local p, _, cred = usableCredential(key)
  if not cred then
    return nil
  end
  return p.headers(cred)
end

-- net.proxyFetch with the credential of key. With signIn it signs in when
-- needed, and a 401 for a stored credential drops it and signs in again.
-- Without, it never signs in, and a 401 is repeated without credentials.
-- Either way a request is repeated at most once.
function auth.fetch(key, url, options, signIn)
  options = options or {}
  local function send(authHeaders)
    local request = {}
    for k, v in pairs(options) do
      request[k] = v
    end
    request.headers = {}
    for k, v in pairs(options.headers or {}) do
      request.headers[k] = v
    end
    for k, v in pairs(authHeaders or {}) do
      request.headers[k] = v
    end
    return net.proxyFetch(url, request)
  end
  local authHeaders
  if signIn then
    authHeaders = auth.headers(key)
  else
    authHeaders = auth.optionalHeaders(key)
  end
  local resp = send(authHeaders)
  if resp.status == 401 and authHeaders then
    -- Revoked or expired on the server. A configured credential is the
    -- user's to fix, so it is only left out (for reads), never replaced.
    local stored = auth.getCredential(key) != nil
    auth.deleteCredential(key)
    if not signIn then
      resp = send(nil)
    elseif stored then
      resp = send(auth.headers(key))
    end
  end
  return resp
end

function auth.list()
  local result = {}
  for _, key in ipairs(auth.listKeys()) do
    local cred = auth.getCredential(key)
    table.insert(result, {
      key = key,
      provider = cred.provider,
      createdAt = cred.createdAt,
    })
  end
  return result
end

local function credentialOptions()
  local options = {}
  for _, item in ipairs(auth.list()) do
    local description = item.provider
    if item.createdAt then
      description = description .. ", connected " .. os.date("%Y-%m-%d %H:%M", item.createdAt / 1000)
    end
    table.insert(options, {name = item.key, description = description})
  end
  return options
end

command.define {
  name = "Credentials: List",
  run = function()
    local options = credentialOptions()
    if #options == 0 then
      editor.flashNotification("No stored credentials")
      return
    end
    editor.filterBox("Credentials", options, "Stored credentials (select to close)")
  end,
}

local clearAll = "All credentials"

command.define {
  name = "Credentials: Clear",
  run = function()
    local options = credentialOptions()
    if #options == 0 then
      editor.flashNotification("No stored credentials")
      return
    end
    if #options > 1 then
      table.insert(options, 1, {name = clearAll, description = "Clear every stored credential"})
    end
    local selected = editor.filterBox("Clear credential", options, "Select a credential to clear")
    if not selected then
      return
    end
    if selected.name == clearAll then
      local keys = auth.listKeys()
      if editor.confirm("Clear all " .. #keys .. " stored credentials?") then
        for _, key in ipairs(keys) do
          auth.deleteCredential(key)
        end
        editor.flashNotification("Cleared all credentials")
      end
    elseif editor.confirm("Clear the credential " .. selected.name .. "?") then
      auth.deleteCredential(selected.name)
      editor.flashNotification("Cleared " .. selected.name)
    end
  end,
}
```
