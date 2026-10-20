#meta

# Implementation
```space-lua
-- priority: 10
share = {}

local shareSchema = {
  type = "object",
  properties = {
    uri = schema.string(),
    hash = schema.string(), -- legacy, no longer written
    mode = schema.string(), -- push | pull | sync
  },
}

-- The change detection hash pages carried in share.hash before bases were
-- kept per device: the first 8 characters of the sha256 of the cleaned text
function share.legacyHash(content)
  content = share.cleanFrontmatter(content)
  return crypto.sha256(content):sub(1, 8)
end

-- Deprecated alias
share.contentHash = share.legacyHash

function share.cleanFrontmatter(text)
  return index.patchFrontmatter(text, {
    {op="delete-key", path="share.uri"},
    {op="delete-key", path="share.hash"},
    {op="delete-key", path="share.mode"},
    {op="delete-key", path="share.transform"},
  })
end

-- Sets the keys of m that are present (uri, mode, transform)
function share.setFrontmatter(m, text)
  local patches = {}
  for _, key in ipairs({"uri", "mode", "transform"}) do
    if m[key] != nil then
      table.insert(patches, {op="set-key", path="share." .. key, value=m[key]})
    end
  end
  return index.patchFrontmatter(text, patches)
end

local function hasTag(tags, wanted)
  if type(tags) == "string" then
    tags = {tags}
  end
  if type(tags) != "table" then
    return false
  end
  for _, tag in ipairs(tags) do
    if wanted[tostring(tag):gsub("^#", "")] then
      return true
    end
  end
  return false
end

local managedTags = {["meta/library"] = true, ["meta/repository"] = true}

-- Installed libraries and repositories: their remote is the source of truth
function share.isManaged(name, text)
  if hasTag(index.extractFrontmatter(text).frontmatter.tags, managedTags) then
    return true
  end
  local ok, meta = pcall(space.getPageMeta, name)
  return ok and meta != nil and hasTag(meta.tags, managedTags)
end

-- The share settings of a page and the text it sends: transformed for push,
-- only without share keys otherwise
function share.prepare(name, text)
  local m = index.extractFrontmatter(text).frontmatter.share
  if type(m) != "table" then
    error("Not configured")
  end
  local mode = m.mode or "push"
  local outgoing
  if mode == "push" then
    local target = share.target(m.uri)
    outgoing = share.transform(text, {
      page = name,
      uri = m.uri,
      target = target,
      members = {[name] = m.uri},
      steps = share.resolveSteps(name, text, target, m.transform),
    })
  else
    outgoing = share.cleanFrontmatter(text)
  end
  return {m = m, mode = mode, outgoing = outgoing}
end

-- Makes sure a transport exists for uri (e.g. connects to a SilverBullet
-- space this page was shared to from another device)
function share.ensureTransport(uri)
  local matches = service.discover("share:ensure", {uri = uri})
  if matches and #matches > 0 then
    service.invoke(matches[1], {uri = uri})
  end
end

-- The text both sides agreed on at the last share from this device: the base
-- for change detection and merging
local function baseKey(uri)
  return "share.base:" .. uri
end

-- Marks bases recorded by this version: older ones may predate a share of
-- the page from another device
local function baseMarkerKey(uri)
  return "share.baseV2:" .. uri
end

local function recordBase(uri, text)
  clientStore.set(baseKey(uri), text)
  clientStore.set(baseMarkerKey(uri), true)
end

-- The base for m, or nil when there is none to trust: an unmarked base whose
-- legacy hash doesn't match the page's share.hash was recorded before the
-- page was shared from elsewhere
local function loadBase(m)
  local base = clientStore.get(baseKey(m.uri))
  if base != nil and m.hash != nil and not clientStore.get(baseMarkerKey(m.uri))
      and share.legacyHash(base) != m.hash then
    return nil
  end
  return base
end

-- Same naming as SilverBullet sync's conflict copies
local function saveConflictCopy(name, remoteText)
  local copyName = name .. ".conflicted-" .. crypto.sha256(remoteText):sub(1, 8)
  space.writePage(copyName, remoteText)
  return copyName
end

local function saveCopyAndNotify(name, remoteText)
  local copyName = saveConflictCopy(name, remoteText)
  editor.flashNotification("Conflict: remote copy saved as " .. copyName, "error")
  return "notified"
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
  local prepared = share.prepare(name, text)
  local m, mode, outgoing = prepared.m, prepared.mode, prepared.outgoing
  local base = loadBase(m)
  -- Pages shared before bases were kept: an unchanged share.hash means this
  -- page is as it was at its last share
  local hint = base == nil and m.hash != nil and m.hash == share.legacyHash(text)

  local function writePage(body)
    local updated = share.setFrontmatter(m, body)
    if editing then
      editor.setText(updated)
    else
      space.writePage(name, updated)
    end
  end

  local function takeRemote(remoteText)
    writePage(remoteText)
    recordBase(m.uri, remoteText)
    return "shared"
  end

  local function writeRemote(body, conditional)
    local written = net.writeURI(m.uri, body, {conditional = conditional})
    if written and written.conflict then
      return "retry"
    end
    recordBase(m.uri, body)
    return "shared"
  end

  local function readRemote()
    local remoteText = net.readURI(m.uri, {encoding="text/markdown"})
    -- A remote page can be shared onward itself
    if remoteText then
      remoteText = share.cleanFrontmatter(remoteText)
    end
    return remoteText
  end

  if mode == "push" then
    -- The hint stands for what old versions pushed: the untransformed text
    if outgoing == base
        or (hint and outgoing == share.cleanFrontmatter(text)) then
      return "unchanged"
    end
    share.ensureTransport(m.uri)
    -- The local page wins (a missing remote page is created). Only without a
    -- base is the remote read, to skip writing what is already there.
    if base == nil and readRemote() == outgoing then
      recordBase(m.uri, outgoing)
      return "unchanged"
    end
    return writeRemote(outgoing, false)
  end
  -- Pulls (e.g. libraries) read through whatever reader matches, never
  -- connecting
  if mode != "pull" then
    share.ensureTransport(m.uri)
  end
  local remoteText = readRemote()
  if remoteText == outgoing then
    recordBase(m.uri, outgoing)
    return "unchanged"
  end
  if not remoteText then
    error("Could not read " .. m.uri)
  end

  if mode == "pull" then
    local overwrite = outgoing == base or hint
      or (base == nil and m.hash == nil and share.isManaged(name, text))
    if not overwrite then
      local message
      if base != nil then
        message = "You changed " .. name .. " locally. Overwrite it with the version from " .. m.uri .. "?"
      else
        message = name .. " differs from " .. m.uri .. ". Overwrite it with the remote version?"
      end
      if not editor.confirm(message) then
        return "unchanged"
      end
    end
    return takeRemote(remoteText)
  end

  -- sync
  if base == nil and not hint then
    local choice = editor.chooseVersion {
      title = "Which version of " .. name .. "?",
      message = "This device can't tell which side changed since the last share.",
      mine = outgoing,
      theirs = remoteText,
      choices = {
        {id = "theirs", label = "Take theirs"},
        {id = "mine", label = "Keep mine"},
        {id = "copy", label = "Save theirs as a copy"},
      },
    }
    if choice == "theirs" then
      return takeRemote(remoteText)
    elseif choice == "mine" then
      return writeRemote(outgoing, true)
    elseif choice == "copy" then
      local copyName = saveConflictCopy(name, remoteText)
      editor.flashNotification("Saved their version as " .. copyName)
      return "notified"
    end
    return "unchanged"
  end
  if hint or outgoing == base then
    return takeRemote(remoteText)
  end
  if remoteText == base then
    return writeRemote(outgoing, true)
  end
  local merged = space.mergeText(base, outgoing, remoteText)
  if not merged then
    return saveCopyAndNotify(name, remoteText)
  end
  if merged.text == remoteText then
    recordBase(m.uri, remoteText)
  elseif writeRemote(merged.text, true) == "retry" then
    return "retry"
  end
  if merged.text != outgoing then
    writePage(merged.text)
  end
  if merged.status == "conflicted" then
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

-- Where the page stands against the base this device last agreed on. same:
-- the outgoing text is the base (or, for pages shared before bases were
-- kept, an unchanged share.hash stands for it); known: there is anything to
-- compare with.
local function localStanding(name, text)
  local prepared = share.prepare(name, text)
  local m, mode, outgoing = prepared.m, prepared.mode, prepared.outgoing
  local base = loadBase(m)
  local hint = base == nil and m.hash != nil and m.hash == share.legacyHash(text)
    and (mode != "push" or outgoing == share.cleanFrontmatter(text))
  return {
    uri = m.uri,
    mode = mode,
    outgoing = outgoing,
    base = base,
    hint = hint,
    same = outgoing == base or hint,
    known = base != nil or hint,
  }
end

-- Offline: has the page changed locally since this device last shared it?
-- state is "unchanged", "localChanged" or "unknown" (nothing to compare with)
function share.status(name)
  local s = localStanding(name, space.readPage(name))
  local state = "unknown"
  if s.same then
    state = "unchanged"
  elseif s.known then
    state = "localChanged"
  end
  return {uri = s.uri, mode = s.mode, state = state}
end

local function checkOne(name)
  local s = localStanding(name, space.readPage(name))
  local result = {uri = s.uri, mode = s.mode}
  -- Never connects: a remote that needs a sign-in throws
  local remoteText = net.readURI(s.uri, {encoding="text/markdown"})
  if remoteText == nil then
    result.state = "missing"
    return result
  end
  remoteText = share.cleanFrontmatter(remoteText)
  if remoteText == s.outgoing then
    result.state = "upToDate"
  elseif not s.known then
    result.state = "differs"
  elseif s.same then
    result.state = "remoteChanged"
  elseif remoteText == s.base then
    result.state = "localChanged"
  else
    result.state = "bothChanged"
  end
  return result
end

-- Reads the remotes of the pages and compares them with the local pages and
-- bases. Never prompts, connects or writes.
function share.check(names)
  local results = {}
  for _, name in ipairs(names) do
    local ok, result = pcall(checkOne, name)
    if ok then
      results[name] = result
    else
      results[name] = {state = "error", error = tostring(result)}
    end
  end
  return results
end

-- Shares the pages in order. opts.onProgress(index, total, name) is called
-- before each page, opts.cancelled() before each page too: a true stops the
-- run, leaving the remaining pages out of the result.
function share.shareMany(names, opts)
  opts = opts or {}
  local results = {}
  for i, name in ipairs(names) do
    if opts.cancelled and opts.cancelled() then
      break
    end
    if opts.onProgress then
      opts.onProgress(i, #names, name)
    end
    local ok, result = pcall(share.sharePage, name)
    if ok then
      results[name] = {ok = true, result = result}
    else
      results[name] = {ok = false, error = tostring(result)}
    end
  end
  return results
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
        local name = editor.getCurrentPage()
        local text = editor.getText()
        local data = {
          name = name,
          text = text,
          content = share.transform(text, {
            page = name,
            target = share.genericTarget,
            members = {},
            steps = share.resolveSteps(name, text, share.genericTarget),
          }),
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
          -- Any hash a provider returns is ignored: setFrontmatter doesn't
          -- write one
          editor.setText(share.setFrontmatter(m, data.text))
          -- Uploads the page unless the provider already did
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
