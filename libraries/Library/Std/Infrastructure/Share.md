#meta

# Implementation
```space-lua
-- priority: 10
share = {}

local shareSchema = {
  type = "object",
  properties = {
    uri = schema.string(),
    hash = schema.string(),
    mode = schema.string(), -- push | pull | sync
  },
}

-- Content change detection hash of 8 characters
-- First strips out share frontmatter-related keys to avoid hash-induced change detections
function share.contentHash(content)
  content = share.cleanFrontmatter(content)
  return crypto.sha256(content):sub(1, 8)
end

function share.cleanFrontmatter(text)
  return index.patchFrontmatter(text, {
    {op="delete-key", path="share.uri"},
    {op="delete-key", path="share.hash"},
    {op="delete-key", path="share.mode"},
  })
end

-- Sets the keys of m that are present (uri, hash, mode)
function share.setFrontmatter(m, text)
  local patches = {}
  for _, key in ipairs({"uri", "hash", "mode"}) do
    if m[key] != nil then
      table.insert(patches, {op="set-key", path="share." .. key, value=m[key]})
    end
  end
  return index.patchFrontmatter(text, patches)
end

-- Makes sure a transport exists for uri (e.g. connects to a SilverBullet
-- space this page was shared to from another device)
function share.ensureTransport(uri)
  local matches = service.discover("share:ensure", {uri = uri})
  if matches and #matches > 0 then
    service.invoke(matches[1], {uri = uri})
  end
end

-- The content both sides agreed on at the last push or sync, kept on this
-- device as the base for merging
local function baseKey(uri)
  return "share.base:" .. uri
end

local function recordBase(uri, text)
  clientStore.set(baseKey(uri), share.cleanFrontmatter(text))
end

-- Three-way merge on the user's own server, or nil when the texts can't be
-- merged (conflict markers, too large) or there is no base: none recorded, or
-- one from before the page was last shared from another device (its hash is
-- not m.hash)
local function mergeRemote(m, localText, remoteText)
  local baseText = clientStore.get(baseKey(m.uri))
  if not baseText or share.contentHash(baseText) != m.hash then
    return nil
  end
  return space.mergeText(baseText, share.cleanFrontmatter(localText),
    share.cleanFrontmatter(remoteText))
end

-- Same naming as SilverBullet sync's conflict copies
local function saveConflictCopy(name, remoteText)
  local copyName = name .. ".conflicted-" .. crypto.sha256(remoteText):sub(1, 8)
  space.writePage(copyName, remoteText)
  return copyName
end

-- One share of the page (the current one without a name). Returns "shared",
-- "unchanged", "notified" (the user was told the outcome: a conflict) or
-- "retry" (a sync write found the remote changed since it was read).
local function shareOnce(name)
  local editing = not name
  local text
  if editing then
    name = editor.getCurrentPage()
    text = editor.getText()
  else
    text = space.readPage(name)
  end
  local m = index.extractFrontmatter(text).frontmatter.share
  if type(m) != "table" then
    error("Not configured")
  end
  local mode = m.mode or "push"

  local localChanged = share.contentHash(text) != m.hash
  if mode == "push" and not localChanged then
    return "unchanged"
  end
  -- Pulls (e.g. libraries) read through whatever reader matches, never
  -- connecting
  if mode != "pull" then
    share.ensureTransport(m.uri)
  end
  -- Push never reads: the local page wins
  local remoteText
  local remoteChanged = false
  if mode != "push" then
    remoteText = net.readURI(m.uri, {encoding="text/markdown"})
    if not remoteText then
      error("Could not read " .. m.uri)
    end
    remoteChanged = share.contentHash(remoteText) != m.hash
  end
  if mode == "pull" then
    if not remoteChanged then
      return "unchanged"
    end
    if localChanged and not editor.confirm("Local changes made to " .. name .. " are you ok to overwrite them with updated remote content from " .. m.uri .. "?") then
      return "unchanged"
    end
    -- The remote wins
    localChanged = false
  end

  local conflicted = false
  if not localChanged and not remoteChanged then
    -- Recorded e.g. on a device that never shared the page before
    recordBase(m.uri, text)
    return "unchanged"
  elseif not localChanged then
    text = remoteText
  else
    if remoteChanged then
      local merged = mergeRemote(m, text, remoteText)
      if not merged then
        local copyName = saveConflictCopy(name, remoteText)
        editor.flashNotification("Conflict: remote copy saved as " .. copyName, "error")
        return "notified"
      end
      text = merged.text
      conflicted = merged.status == "conflicted"
    end
    local written = net.writeURI(m.uri, share.cleanFrontmatter(text),
      {conditional = mode == "sync"})
    if written and written.conflict then
      return "retry"
    end
  end

  m.hash = share.contentHash(text)
  m.mode = mode
  local updatedText = share.setFrontmatter(m, text)
  if editing then
    editor.setText(updatedText)
  else
    space.writePage(name, updatedText)
  end
  -- Pulls don't need a base (e.g. libraries)
  if mode != "pull" then
    recordBase(m.uri, text)
  end
  if conflicted then
    editor.flashNotification("Merged with conflicts — resolve the markers, then share again", "error")
    return "notified"
  end
  return "shared"
end

local results = {shared = true, unchanged = false}

-- Returns true if something was shared, false if there was nothing to do,
-- nil if the user was already notified of the outcome (conflicts)
function share.sharePage(name)
  local outcome = shareOnce(name)
  if outcome == "retry" then
    outcome = shareOnce(name)
  end
  if outcome == "retry" then
    error("Conflict: the remote changed again while sharing, try again")
  end
  return results[outcome]
end

command.define {
  name = "Share: Page",
  key = "Ctrl-p",
  mac = "Cmd-p",
  run = function()
    local ok, ret = pcall(share.sharePage)
    if ok then
      if ret then
        editor.flashNotification "Share successful"
      elseif ret == false then
        editor.flashNotification "No changes"
      end -- nil: sharePage already notified
    else -- error
      if ret == "Not configured" then
        local data = {
          name = editor.getCurrentPage(),
          text = editor.getText()
        }
        local shareProviders = service.discover("share:onboard", data)
        local provider = editor.filterBox("Share provider", shareProviders, "Select how you would like to share this page")
        if not provider then
          return
        end
  
        local onboarded, m = pcall(service.invoke, provider, data)
        if not onboarded then
          editor.flashNotification("Error: " .. m, "error")
        elseif m then
          editor.setText(share.setFrontmatter(m, data.text))
          -- Uploads the page unless the provider already did (and set the hash)
          local shared, err = pcall(share.sharePage)
          if shared then
            editor.flashNotification "Share complete!"
          else
            editor.flashNotification("Error: " .. err, "error")
          end
        end
      else
        editor.flashNotification("Error: ".. ret)
      end
    end
  end
}
```
