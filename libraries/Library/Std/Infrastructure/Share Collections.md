#meta

Collection shares for [[Share]]: sets of pages, chosen in config, published together under one target root with the links between them kept.

# Implementation
```space-lua
-- priority: 8

config.define("share.collections", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      pages = schema.func(),
      uri = schema.string(),
      path = schema.func(),
      mode = schema.string(),
      transform = {},
    },
    required = {"pages", "uri"},
  },
})

local function definitions()
  return config.get("share.collections") or {}
end

function share.collections()
  local names = {}
  for name in pairs(definitions()) do
    table.insert(names, name)
  end
  table.sort(names)
  return names
end

-- A collection's target root: its uri without trailing slashes, so member
-- URIs match the listing
local function rootOf(def)
  return (def.uri:gsub("/+$", ""))
end

-- The collection and its config entry
local function resolve(name)
  local def = definitions()[name]
  if def == nil then
    error("Unknown collection: " .. name)
  end
  local prefix = "Collection " .. name .. ": "
  if def.mode != nil and def.mode != "push" then
    error(prefix .. "mode must be push")
  end
  local ok, pages = pcall(def.pages)
  if not ok then
    error(prefix .. tostring(pages))
  end
  local root = rootOf(def)
  local memberUri = share.target(root).memberUri or share.genericTarget.memberUri
  -- pageAt is by member URI: a provider may map two paths to one file
  local members, pageAt, seen = {}, {}, {}
  -- The path of page p (only the first result: gsub also returns a count)
  local function pathOf(p)
    if not def.path then
      return p.name
    end
    local ok, path = pcall(function()
      return (def.path(p))
    end)
    if not ok then
      error(prefix .. tostring(path))
    end
    return path
  end
  -- pages() may return a query collection (e.g. index.contentPages) or an
  -- array; nil means no members
  local rows = {}
  if pages != nil then
    rows = query[[from p = pages select p]]
  end
  for _, p in ipairs(rows) do
    if type(p) == "string" then
      p = {name = p}
    end
    -- A page listed twice is one member
    if not seen[p.name] then
      seen[p.name] = true
      local path = pathOf(p)
      local uri = memberUri(root, path)
      if pageAt[uri] then
        error(prefix .. pageAt[uri] .. " and " .. p.name .. " both go to " .. path)
      end
      pageAt[uri] = p.name
      table.insert(members, {page = p.name, path = path, uri = uri})
    end
  end
  return {name = name, root = root, mode = "push", members = members}, def
end

function share.collection(name)
  return (resolve(name))
end

-- How c shares its members: its target and the member URIs by page
local function shareSet(c)
  local uris = {}
  for _, m in ipairs(c.members) do
    uris[m.page] = m.uri
  end
  return {target = share.target(c.root), uris = uris}
end

-- What member m sends, its page being text: transformed with the collection
-- as the share set
local function outgoingOf(set, def, m, text)
  return share.transform(text, {
    page = m.page,
    uri = m.uri,
    target = set.target,
    members = set.uris,
    steps = share.resolveSteps(m.page, text, set.target, def.transform),
  })
end

-- What each member sends, by page
local function outgoingTexts(c, def)
  local set = shareSet(c)
  local texts = {}
  for _, m in ipairs(c.members) do
    texts[m.page] = outgoingOf(set, def, m, space.readPage(m.page))
  end
  return texts
end

-- The files under root as listed, by URI, or nil when the target can't list.
-- signIn lets the provider sign in to list (publish only: check never prompts).
local function listing(root, signIn)
  local entries = net.listURI(root, {signIn = signIn})
  if entries == nil then
    return nil
  end
  local files = {}
  for _, entry in ipairs(entries) do
    files[entry.uri] = entry
  end
  return files
end

-- Listed files no member maps to, sorted
local function unmapped(c, files)
  local memberUris = {}
  for _, m in ipairs(c.members) do
    memberUris[m.uri] = true
  end
  local uris = {}
  for uri in pairs(files) do
    if not memberUris[uri] then
      table.insert(uris, uri)
    end
  end
  table.sort(uris)
  return uris
end

local function checkMember(m, outgoing, files)
  local entry = files and files[m.uri]
  local remote
  if entry and entry.hash then
    remote = {sha = entry.hash}
  elseif entry or not files then
    -- Not listed, or listed without a hash: read it
    local remoteText = share.readRemote(m.uri)
    remote = remoteText and {text = remoteText}
  end -- Not in the listing: missing
  return share.remoteState {remote = remote, outgoing = outgoing}
end

-- Reads the remote (one listing where the target can list) and compares it
-- with the members. Never prompts, connects or writes.
function share.checkCollection(name)
  local c, def = resolve(name)
  local outgoing = outgoingTexts(c, def)
  local files = listing(c.root)
  local members = {}
  for _, m in ipairs(c.members) do
    local ok, state = pcall(checkMember, m, outgoing[m.page], files)
    if ok then
      members[m.page] = {uri = m.uri, state = state}
    else
      members[m.page] = {uri = m.uri, state = "error", error = tostring(state)}
    end
  end
  return {members = members, removed = files and unmapped(c, files) or {}}
end

-- Whether the remote differs from text: by the listed hash, else by reading
-- it. A remote that can't be read is written all the same.
local function needsWrite(m, text, files)
  if files then
    local entry = files[m.uri]
    if entry == nil then
      return true
    end
    if entry.hash then
      return share.gitBlobSha(text) != entry.hash
    end
  end
  local ok, remoteText = pcall(share.readRemote, m.uri)
  return not ok or remoteText != text
end

-- How a file under root reads to the user: its path below root, decoded
-- (gist file names aren't encoded, so a "%" may not decode)
function share.collectionLabel(root, uri)
  if uri:startsWith(root .. "/") then
    local tail = uri:sub(#root + 2)
    local ok, decoded = pcall(encoding.urlDecode, tail)
    return ok and decoded or tail
  end
  return uri
end

-- The listed files no member maps to that the user ticks for deletion
local function pickDeletes(c, files)
  local stale = files and unmapped(c, files) or {}
  if #stale == 0 then
    return {}
  end
  local items = {}
  for _, uri in ipairs(stale) do
    table.insert(items, {id = uri, label = share.collectionLabel(c.root, uri)})
  end
  return editor.pickMany {
    title = "Remove from " .. c.root .. "?",
    message = "These files are no longer in the collection.",
    items = items,
    confirmLabel = "Remove",
  } or {}
end

local function sendBatch(match, c, writes, deletes, result)
  local payload = {root = c.root, writes = {}, deletes = deletes}
  for _, w in ipairs(writes) do
    table.insert(payload.writes, {uri = w.uri, content = w.content})
  end
  local ok, err = pcall(service.invoke, match, payload)
  -- The user dismissed the batch (e.g. GitHub's commit message prompt)
  if ok and type(err) == "table" and err.cancelled then
    result.cancelled = true
    return
  end
  if not ok then
    for _, w in ipairs(writes) do
      table.insert(result.failed, {page = w.page, uri = w.uri, error = tostring(err)})
    end
    for _, uri in ipairs(deletes) do
      table.insert(result.failed, {uri = uri, error = tostring(err)})
    end
    return
  end
  for _, w in ipairs(writes) do
    table.insert(result.written, w.page)
  end
  result.removed = deletes
end

local function sendEach(writes, deletes, result)
  for _, w in ipairs(writes) do
    local ok, err = pcall(net.writeURI, w.uri, w.content)
    if ok then
      table.insert(result.written, w.page)
    else
      table.insert(result.failed, {page = w.page, uri = w.uri, error = tostring(err)})
    end
  end
  for _, uri in ipairs(deletes) do
    local ok, err = pcall(net.deleteURI, uri)
    if ok then
      table.insert(result.removed, uri)
    else
      table.insert(result.failed, {uri = uri, error = tostring(err)})
    end
  end
end

-- Writes the members that changed and deletes the files the user picks from
-- those no member maps to: in one call to a share:writeBatch service where
-- the target has one. Failed writes and deletes are in failed ({page?, uri,
-- error}); their remotes still differ, so the next publish retries them.
-- A batch the user cancelled writes nothing and sets cancelled.
function share.publishCollection(name)
  -- First, so the target (and so the member URIs) is that of a transport
  -- set up just now
  local entry = definitions()[name]
  if entry != nil then
    share.ensureTransport(rootOf(entry))
  end
  local c, def = resolve(name)
  local outgoing = outgoingTexts(c, def)
  local files = listing(c.root, true)
  local result = {written = {}, unchanged = {}, removed = {}, failed = {}}
  local writes = {}
  for _, m in ipairs(c.members) do
    local text = outgoing[m.page]
    if needsWrite(m, text, files) then
      table.insert(writes, {page = m.page, uri = m.uri, content = text})
    else
      table.insert(result.unchanged, m.page)
    end
  end
  local deletes = pickDeletes(c, files)
  if #writes == 0 and #deletes == 0 then
    return result
  end
  local batch = service.discover("share:writeBatch:" .. c.root, {root = c.root})
  if batch and #batch > 0 then
    sendBatch(batch[1], c, writes, deletes, result)
  else
    sendEach(writes, deletes, result)
  end
  return result
end

-- Collections with a member whose remote differs or is missing, as
-- share.checkCollection tells (so their remotes are read)
function share.changedCollections()
  local names = {}
  for _, name in ipairs(share.collections()) do
    -- A collection that can't be checked is left for its own publish to report
    local ok, checked = pcall(share.checkCollection, name)
    if ok then
      for _, m in pairs(checked.members) do
        if m.state == "differs" or m.state == "missing" then
          table.insert(names, name)
          break
        end
      end
    end
  end
  return names
end

-- One entry of publishCollection's failed, for a notification
function share.collectionFailure(f)
  return (f.page or f.uri) .. ": " .. f.error
end

-- Tells the user how a publish went, from what
-- pcall(share.publishCollection, name) returned
function share.notifyPublished(name, ok, r)
  if not ok then
    editor.flashNotification("Error: " .. r, "error")
    return
  end
  if r.cancelled then
    editor.flashNotification("Publish of " .. name .. " cancelled")
    return
  end
  local summary = "Published " .. name .. ": " .. #r.written .. " written, "
    .. #r.unchanged .. " unchanged"
  if #r.removed > 0 then
    summary = summary .. ", " .. #r.removed .. " removed"
  end
  editor.flashNotification(summary)
  if #r.failed > 0 then
    editor.flashNotification(share.collectionFailure(r.failed[1]), "error")
  end
end

command.define {
  name = "Share: Collection",
  requireMode = "rw",
  run = function()
    local options = {}
    for _, name in ipairs(share.collections()) do
      table.insert(options, {name = name})
    end
    if #options == 0 then
      editor.flashNotification("No collections configured", "error")
      return
    end
    local picked = editor.filterBox("Collection", options)
    if picked then
      share.notifyPublished(picked.name,
        pcall(share.publishCollection, picked.name))
    end
  end
}
```
