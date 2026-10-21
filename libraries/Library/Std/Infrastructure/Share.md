#meta

# Implementation
```space-lua
-- priority: 10
share = {}

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
    -- A share: map, as well as dotted share.* keys
    {op="delete-key", path="share"},
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

-- Whether the page has a tag pred accepts, in its text or in the index
local function pageHasTag(name, text, pred)
  local function anyTag(tags)
    if type(tags) == "string" then
      tags = {tags}
    end
    if type(tags) != "table" then
      return false
    end
    for _, tag in ipairs(tags) do
      if pred((tostring(tag):gsub("^#", ""))) then
        return true
      end
    end
    return false
  end
  if anyTag(index.extractFrontmatter(text).frontmatter.tags) then
    return true
  end
  local ok, meta = pcall(space.getPageMeta, name)
  return ok and meta != nil and anyTag(meta.tags)
end

local managedTags = {["meta/library"] = true, ["meta/repository"] = true}

-- Installed libraries and repositories: their remote is the source of truth
function share.isManaged(name, text)
  return pageHasTag(name, text, function(tag)
    return managedTags[tag] == true
  end)
end

-- Library pages (tagged meta or meta/*) are shared as they are
function share.isExempt(name, text)
  return pageHasTag(name, text, function(tag)
    return tag == "meta" or tag:startsWith("meta/")
  end)
end

-- The share settings of a page and the text it sends: transformed for push,
-- only without share keys otherwise
function share.prepare(name, text)
  local m = index.extractFrontmatter(text).frontmatter.share
  if type(m) != "table" or m.uri == nil then
    error("Not configured")
  end
  local mode = m.mode or "push"
  local outgoing, target
  if mode == "push" then
    target = share.target(m.uri)
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
  return {m = m, mode = mode, outgoing = outgoing, target = target}
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

-- Whether text is what an older version shared, by the share.hash it left
local function legacyMatches(hash, text)
  return hash != nil and tostring(hash) == share.legacyHash(text)
end

-- The base for uri, or nil when there is none to trust: an unmarked base
-- that doesn't match the page's share.hash was recorded before the page was
-- shared from elsewhere
local function loadBase(uri, hash)
  local base = clientStore.get(baseKey(uri))
  if base != nil and hash != nil and not clientStore.get(baseMarkerKey(uri))
      and not legacyMatches(hash, base) then
    return nil
  end
  return base
end

-- Whether text is what was agreed at the last share: the base, or without
-- one what the legacy share.hash describes. False when nothing is known.
local function isLastShared(base, hash, text)
  if base != nil then
    return text == base
  end
  return legacyMatches(hash, text)
end

-- The remote's text without its share keys (a remote page can be shared
-- onward itself), or nil when it is missing
local function readRemote(uri)
  local remoteText = net.readURI(uri, {encoding="text/markdown"})
  if remoteText then
    remoteText = share.cleanFrontmatter(remoteText)
  end
  return remoteText
end

-- Where a page stands against the base this device last agreed on. hint:
-- for pages shared before bases were kept, an unchanged share.hash stands
-- for the base (for push only when transforms change nothing, since older
-- versions pushed the page untransformed). same: the outgoing text is the
-- base; known: there is anything to compare with.
local function standing(name, text)
  local prepared = share.prepare(name, text)
  local m, mode, outgoing = prepared.m, prepared.mode, prepared.outgoing
  local base = loadBase(m.uri, m.hash)
  local hint = base == nil and legacyMatches(m.hash, text)
    and (mode != "push" or outgoing == share.cleanFrontmatter(text))
  return {
    name = name,
    text = text,
    m = m,
    uri = m.uri,
    mode = mode,
    target = prepared.target,
    outgoing = outgoing,
    base = base,
    same = outgoing == base or hint,
    known = base != nil or hint,
  }
end

-- Same naming as SilverBullet sync's conflict copies
local function saveConflictCopy(name, remoteText)
  local copyName = name .. ".conflicted-" .. crypto.sha256(remoteText):sub(1, 8)
  space.writePage(copyName, remoteText)
  return copyName
end

local function writeLocal(s, body)
  local updated = share.setFrontmatter(s.m, body)
  if s.editing then
    editor.setText(updated)
  else
    space.writePage(s.name, updated)
  end
end

local function takeRemote(s, remoteText)
  writeLocal(s, remoteText)
  recordBase(s.uri, remoteText)
  return "shared"
end

local function writeRemote(s, body, conditional)
  local written = net.writeURI(s.uri, body, {conditional = conditional})
  if written and written.conflict then
    return "retry"
  end
  recordBase(s.uri, body)
  return "shared"
end

-- For pull and sync: the remote text, or nil when it is what this side has
-- (then recorded as the base)
local function remoteDiffering(s)
  local remoteText = readRemote(s.uri)
  if remoteText == s.outgoing then
    recordBase(s.uri, s.outgoing)
    return nil
  end
  if not remoteText then
    error("Could not read " .. s.uri)
  end
  return remoteText
end

local strategies = {}

-- The local page wins (a missing remote page is created). Only without a
-- base is the remote read, to skip writing what is already there; a
-- transport that can't read is written to all the same.
function strategies.push(s)
  if s.same then
    return "unchanged"
  end
  share.ensureTransport(s.uri)
  -- A transport set up just now may come with its own target
  if share.target(s.uri).kind != s.target.kind then
    local editing = s.editing
    s = standing(s.name, s.text)
    s.editing = editing
    if s.same then
      return "unchanged"
    end
  end
  if s.base == nil then
    local ok, remoteText = pcall(readRemote, s.uri)
    if ok and remoteText == s.outgoing then
      recordBase(s.uri, s.outgoing)
      return "unchanged"
    end
  end
  return writeRemote(s, s.outgoing, false)
end

-- The remote wins, asking first when there are local changes. Reads through
-- whatever reader matches, never connecting (e.g. libraries).
function strategies.pull(s)
  local remoteText = remoteDiffering(s)
  -- Only local changes: nothing to pull
  if remoteText == nil or isLastShared(s.base, s.m.hash, remoteText) then
    return "unchanged"
  end
  local overwrite = s.same
    or (s.base == nil and s.m.hash == nil and share.isManaged(s.name, s.text))
  if not overwrite then
    local message
    if s.base != nil then
      message = "You changed " .. s.name .. " locally. Overwrite it with the version from " .. s.uri .. "?"
    else
      message = s.name .. " differs from " .. s.uri .. ". Overwrite it with the remote version?"
    end
    if not editor.confirm(message) then
      return "unchanged"
    end
  end
  return takeRemote(s, remoteText)
end

-- Without a base there is no telling which side changed: the user picks
local function chooseVersion(s, remoteText)
  local choice = editor.chooseVersion {
    title = "Which version of " .. s.name .. "?",
    message = "This device can't tell which side changed since the last share.",
    mine = s.outgoing,
    theirs = remoteText,
    choices = {
      {id = "theirs", label = "Take theirs"},
      {id = "mine", label = "Keep mine"},
      {id = "copy", label = "Save theirs as a copy"},
    },
  }
  if choice == "theirs" then
    return takeRemote(s, remoteText)
  elseif choice == "mine" then
    return writeRemote(s, s.outgoing, true)
  elseif choice == "copy" then
    local copyName = saveConflictCopy(s.name, remoteText)
    editor.flashNotification("Saved their version as " .. copyName)
  end
  -- Cancelled: the sides still differ, as the user knows
  return "notified"
end

-- Both sides changed: a three-way merge on the base
local function merge(s, remoteText)
  local merged = space.mergeText(s.base, s.outgoing, remoteText)
  if not merged then
    local copyName = saveConflictCopy(s.name, remoteText)
    editor.flashNotification("Conflict: remote copy saved as " .. copyName, "error")
    return "notified"
  end
  if merged.text == remoteText then
    recordBase(s.uri, remoteText)
  elseif writeRemote(s, merged.text, true) == "retry" then
    return "retry"
  end
  if merged.text != s.outgoing then
    writeLocal(s, merged.text)
  end
  if merged.status == "conflicted" then
    editor.flashNotification("Merged with conflicts — resolve the markers, then share again", "error")
    return "notified"
  end
  return "shared"
end

function strategies.sync(s)
  share.ensureTransport(s.uri)
  local remoteText = remoteDiffering(s)
  if remoteText == nil then
    return "unchanged"
  end
  if not s.known then
    return chooseVersion(s, remoteText)
  end
  if s.same then
    return takeRemote(s, remoteText)
  end
  if remoteText == s.base then
    return writeRemote(s, s.outgoing, true)
  end
  return merge(s, remoteText)
end

-- One share of the page (the current one without a name). Returns "shared",
-- "unchanged", "notified" (the user was told the outcome, e.g. a conflict) or
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
  local s = standing(name, text)
  s.editing = editing
  return (strategies[s.mode] or strategies.sync)(s)
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

-- Offline: has the page changed locally since this device last shared it?
-- state is "unchanged", "localChanged" or "unknown" (nothing to compare with)
function share.status(name)
  local s = standing(name, space.readPage(name))
  local state = "unknown"
  if s.same then
    state = "unchanged"
  elseif s.known then
    state = "localChanged"
  end
  return {uri = s.uri, mode = s.mode, state = state}
end

local function checkOne(name)
  local s = standing(name, space.readPage(name))
  local result = {uri = s.uri, mode = s.mode}
  -- Never connects: a remote that needs a sign-in throws
  local remoteText = readRemote(s.uri)
  if remoteText == nil then
    result.state = "missing"
  elseif remoteText == s.outgoing then
    result.state = "upToDate"
  elseif s.same then
    result.state = "remoteChanged"
  elseif isLastShared(s.base, s.m.hash, remoteText) then
    result.state = "localChanged"
  elseif not s.known then
    result.state = "differs"
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

-- Whether to replace the installed page with remoteText: only when the
-- remote changed since this device installed it, and when the page was edited
-- here since, only if the user agrees. Without a base or share.hash the
-- remote wins.
local function shouldUpdate(installed, uri, remoteText)
  local text = space.readPage(installed)
  local localText = share.cleanFrontmatter(text)
  if localText == remoteText then
    return false
  end
  local m = index.extractFrontmatter(text).frontmatter.share
  local hash = type(m) == "table" and m.hash or nil
  local base = loadBase(uri, hash)
  if isLastShared(base, hash, remoteText) then
    return false
  end
  local edited = (base != nil or hash != nil)
    and not isLastShared(base, hash, localText)
  return not edited or editor.confirm("You changed " .. installed
    .. " locally. Overwrite it with the version from " .. uri .. "?")
end

-- The Library Manager's pull: see docs/API/share.md
function share.install(uri, opts)
  opts = opts or {}
  local remoteText = net.readURI(uri, {encoding="text/markdown"})
  if type(remoteText) != "string" then
    error("Could not fetch " .. uri)
  end
  local fm = index.extractFrontmatter(remoteText).frontmatter
  local page = opts.page or fm.name
  if not page then
    error("Library frontmatter missing required 'name'")
  end
  remoteText = share.cleanFrontmatter(remoteText)
  local result = {page = page, files = fm.files, changed = false}
  if opts.installed then
    if not opts.force and not shouldUpdate(opts.installed, uri, remoteText) then
      return result
    end
  elseif space.pageExists(page) then
    error("Page already exists: " .. page)
  end
  space.writePage(page, share.setFrontmatter({uri = uri, mode = "pull"}, remoteText))
  recordBase(uri, remoteText)
  result.changed = true
  return result
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
        -- What a provider that uploads during onboarding may publish
        local prepared, content = pcall(share.transform, text, {
          page = name,
          target = share.genericTarget,
          members = {},
          steps = share.resolveSteps(name, text, share.genericTarget),
        })
        if not prepared then
          editor.flashNotification("Error: " .. content, "error")
          return
        end
        local data = {name = name, text = text, content = content}
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
          -- Uploads the page unless the provider already did; a failure
          -- leaves the page unshared, so the providers are offered again
          local shared, err = pcall(share.sharePage)
          if shared then
            editor.flashNotification "Share complete!"
          else
            editor.setText(data.text)
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
