#meta

# Implementation
```space-lua
-- priority: 10
share = {}

-- The hash pull and sync shares keep in share.hash, of the text both sides
-- agreed on at the last pull or sync: the first 8 characters of the sha256 of
-- the cleaned text. The name stays from when it was on its way out.
function share.legacyHash(content)
  content = share.cleanFrontmatter(content)
  return crypto.sha256(content):sub(1, 8)
end

-- An older name for it
share.contentHash = share.legacyHash

-- The git blob id of text: what GitHub's tree listing reports for a file with
-- that content
function share.gitBlobSha(text)
  -- # and string.len count UTF-16 units and byte buffers have no length, so
  -- derive the UTF-8 byte count from the unpadded Base64 length
  local b64 = encoding.base64Encode(text)
  local padding = #b64:match("=*$")
  local size = #b64 // 4 * 3 - padding
  -- string.char(0) because the "\0" escape is not parsed as a NUL byte
  return crypto.sha1("blob " .. size .. string.char(0) .. text)
end

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

-- Sets the keys of m that are present (uri, mode, transform, hash)
function share.setFrontmatter(m, text)
  local patches = {}
  for _, key in ipairs({"uri", "mode", "transform", "hash"}) do
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

-- Whether share.hash describes text. A hash written without quotes may read
-- back as a number (e.g. 83464e55)
local function hashMatches(hash, text)
  if hash == nil then
    return false
  end
  local expected = share.legacyHash(text)
  if type(hash) == "number" then
    return tonumber(expected) == hash
  end
  return tostring(hash) == expected
end

-- For Std pages: a memo of results by key, each kept while its inputs (a
-- table of values compared with ==) stay the same. memo(key, inputs, compute)
-- returns the result, computed only when the inputs changed; copy (if given)
-- makes what callers get, so changing it leaves the memo alone.
function share.memo(copy)
  copy = copy or function(r)
    return r
  end
  local entries = {}
  local function sameInputs(a, b)
    for k, v in pairs(a) do
      if b[k] != v then
        return false
      end
    end
    for k in pairs(b) do
      if a[k] == nil then
        return false
      end
    end
    return true
  end
  return function(key, inputs, compute)
    local entry = entries[key]
    if entry == nil or not sameInputs(entry.inputs, inputs) then
      entry = {inputs = inputs, result = compute()}
      entries[key] = entry
    end
    return copy(entry.result)
  end
end

-- The remote's text without its share keys (a remote page can be shared
-- onward itself), or nil when it is missing
function share.readRemote(uri)
  local remoteText = net.readURI(uri, {encoding="text/markdown"})
  if remoteText then
    remoteText = share.cleanFrontmatter(remoteText)
  end
  return remoteText
end
local readRemote = share.readRemote

-- How a remote stands against the outgoing text, as share.check and
-- share.checkCollection report it. r.remote is nil when missing, else {text}
-- or {sha} (a git blob SHA, see share.gitBlobSha). r.hash is the page's
-- share.hash (pull and sync only): without one, there is no telling which
-- side changed. It is compared with r.remote.text only.
function share.remoteState(r)
  local remote = r.remote
  if remote == nil then
    return "missing"
  end
  local remoteIs
  if remote.text != nil then
    remoteIs = function(text)
      return text == remote.text
    end
  else
    remoteIs = function(text)
      return share.gitBlobSha(text) == remote.sha
    end
  end
  if remoteIs(r.outgoing) then
    return "upToDate"
  elseif r.hash == nil then
    return "differs"
  elseif remote.text != nil and hashMatches(r.hash, remote.text) then
    return "localChanged"
  elseif hashMatches(r.hash, r.outgoing) then
    return "remoteChanged"
  end
  return "bothChanged"
end

-- The share in progress for a page: its settings, what it sends and its
-- share.hash
local function standing(name, text)
  local prepared = share.prepare(name, text)
  local m = prepared.m
  return {
    name = name,
    text = text,
    m = m,
    uri = m.uri,
    mode = prepared.mode,
    target = prepared.target,
    outgoing = prepared.outgoing,
    hash = m.hash,
  }
end

-- Same naming as SilverBullet sync's conflict copies
local function saveConflictCopy(name, remoteText)
  local copyName = name .. ".conflicted-" .. crypto.sha256(remoteText):sub(1, 8)
  space.writePage(copyName, remoteText)
  return copyName
end

-- Writes body, the remote's text just taken, to the page with its hash
local function writeLocal(s, body)
  local m = {
    uri = s.m.uri,
    mode = s.m.mode,
    transform = s.m.transform,
    hash = share.legacyHash(body),
  }
  local updated = share.setFrontmatter(m, body)
  if s.editing then
    editor.setText(updated)
  else
    space.writePage(s.name, updated)
  end
end

-- For pull and sync, after a share that agreed on a text with the remote:
-- sets the page's share.hash to match it, on the page as it is now (it may
-- have been edited during the share, or written with the hash already)
local function keepHash(s)
  local text
  if s.editing then
    text = editor.getText()
  else
    text = space.readPage(s.name)
  end
  local m = index.extractFrontmatter(text).frontmatter.share
  local hash = type(m) == "table" and m.hash or nil
  if hashMatches(hash, s.agreed) then
    return
  end
  local updated = share.setFrontmatter({hash = share.legacyHash(s.agreed)}, text)
  if s.editing then
    editor.setText(updated)
  else
    space.writePage(s.name, updated)
  end
end

local function takeRemote(s, remoteText)
  writeLocal(s, remoteText)
  s.agreed = remoteText
  return "shared"
end

local function writeRemote(s, body, conditional)
  local written = net.writeURI(s.uri, body, {conditional = conditional})
  if written and written.conflict then
    return "retry"
  end
  s.agreed = body
  return "shared"
end

-- For pull and sync: the remote text, or nil when it is what this side has
-- (then agreed on)
local function remoteDiffering(s)
  local remoteText = readRemote(s.uri)
  if remoteText == s.outgoing then
    s.agreed = s.outgoing
    return nil
  end
  if not remoteText then
    error("Could not read " .. s.uri)
  end
  return remoteText
end

local strategies = {}

-- The local page wins (a missing remote page is created), unless the remote
-- already has it. A transport that can't read is written to all the same.
function strategies.push(s)
  share.ensureTransport(s.uri)
  -- A transport set up just now may come with its own target, which changes
  -- what is sent
  if share.target(s.uri).kind != s.target.kind then
    local editing = s.editing
    s = standing(s.name, s.text)
    s.editing = editing
  end
  local ok, remoteText = pcall(readRemote, s.uri)
  if ok and remoteText == s.outgoing then
    return "unchanged"
  end
  return writeRemote(s, s.outgoing, false)
end

-- The remote wins, asking first when there are local changes (or no
-- share.hash to tell). Reads through whatever reader matches, never
-- connecting (e.g. libraries).
function strategies.pull(s)
  local remoteText = remoteDiffering(s)
  -- Only local changes: nothing to pull
  if remoteText == nil or hashMatches(s.hash, remoteText) then
    return "unchanged"
  end
  local message
  if s.hash == nil then
    if not share.isManaged(s.name, s.text) then
      message = s.name .. " differs from " .. s.uri .. ". Overwrite it with the remote version?"
    end
  elseif not hashMatches(s.hash, s.outgoing) then
    message = "You changed " .. s.name .. " locally. Overwrite it with the version from " .. s.uri .. "?"
  end
  if message and not editor.confirm(message) then
    return "unchanged"
  end
  return takeRemote(s, remoteText)
end

-- When there is no telling which side to keep: the user picks
local function chooseVersion(s, remoteText, message)
  local choice = editor.chooseVersion {
    title = "Which version of " .. s.name .. "?",
    message = message,
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

-- share.hash tells which side changed since the last pull or sync
function strategies.sync(s)
  share.ensureTransport(s.uri)
  local remoteText = remoteDiffering(s)
  if remoteText == nil then
    return "unchanged"
  end
  if s.hash == nil then
    return chooseVersion(s, remoteText,
      "There's no record of the last share to tell which side changed.")
  end
  local localChanged = not hashMatches(s.hash, s.outgoing)
  local remoteChanged = not hashMatches(s.hash, remoteText)
  if not localChanged then
    return takeRemote(s, remoteText)
  elseif not remoteChanged then
    return writeRemote(s, s.outgoing, true)
  end
  return chooseVersion(s, remoteText, "Both sides changed since the last share.")
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
  local outcome = (strategies[s.mode] or strategies.sync)(s)
  if s.mode != "push" and s.agreed != nil then
    keepHash(s)
  end
  return outcome
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

-- Offline: has the page changed since its last pull or sync, as its
-- share.hash tells? state is "unchanged", "localChanged", "unknown" (no
-- share.hash) or, for push, "unchecked" (nothing to compare with offline).
-- Memoized per page on its text, as views ask for it often
local statusMemo = share.memo(function(r)
  return {uri = r.uri, mode = r.mode, state = r.state}
end)

function share.status(name)
  local text = space.readPage(name)
  return statusMemo(name, {text = text}, function()
    local m = index.extractFrontmatter(text).frontmatter.share
    if type(m) != "table" or m.uri == nil then
      error("Not configured")
    end
    local mode = m.mode or "push"
    local state = "unchecked"
    if mode == "push" then
      -- Push keeps no share.hash: only the remote can tell
    elseif m.hash == nil then
      state = "unknown"
    elseif hashMatches(m.hash, share.cleanFrontmatter(text)) then
      state = "unchanged"
    else
      state = "localChanged"
    end
    return {uri = m.uri, mode = mode, state = state}
  end)
end

local function checkOne(name)
  local s = standing(name, space.readPage(name))
  -- Never connects: a remote that needs a sign-in throws
  local remoteText = readRemote(s.uri)
  return {
    uri = s.uri,
    mode = s.mode,
    state = share.remoteState {
      remote = remoteText and {text = remoteText},
      outgoing = s.outgoing,
      -- A push page's share.hash (from older versions) says nothing
      hash = s.mode != "push" and s.hash or nil,
    },
  }
end

-- Reads the remotes of the pages and compares them with the local pages and
-- their share.hash. Never prompts, connects or writes.
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
-- remote changed since it was installed (as share.hash tells), and when the
-- page was edited since, only if the user agrees. Without a share.hash the
-- remote wins.
local function shouldUpdate(installed, uri, remoteText)
  local text = space.readPage(installed)
  local localText = share.cleanFrontmatter(text)
  if localText == remoteText then
    return false
  end
  local m = index.extractFrontmatter(text).frontmatter.share
  local hash = type(m) == "table" and m.hash or nil
  if hashMatches(hash, remoteText) then
    return false
  end
  local edited = hash != nil and not hashMatches(hash, localText)
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
  space.writePage(page, share.setFrontmatter({
    uri = uri,
    mode = "pull",
    hash = share.legacyHash(remoteText),
  }, remoteText))
  result.changed = true
  return result
end
```
