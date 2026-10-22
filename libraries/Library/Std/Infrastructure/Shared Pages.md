#meta

Lists every shared page, library and repository in a sidebar, with its share status. Open it with ${widgets.commandButton("Navigate: Shared Pages")}.

# Implementation
```space-lua
-- priority: 5

-- The unit separator (Space Lua has no decimal escapes, so not "\31")
local SEP = "\x1f"

local groups = {
  {kind = "page", label = "Pages"},
  {kind = "collection", label = "Collections"},
  {kind = "library", label = "Libraries"},
  {kind = "repository", label = "Repositories"},
}

-- Every row has a kind: group, collection, page, member, removed, error,
-- library or repository
local icons = {
  group = "folder",
  collection = "folder",
  page = "share-2",
  member = "share-2",
  removed = "file-minus",
  error = "alert-triangle",
  library = "package",
  repository = "database",
}

-- Chip text, and the full sentence for its tooltip. A push page's offline
-- "unchecked" has none: only a Check tells.
local statusLabels = {
  localChanged = {"changed here", "Changed since its last share"},
  unknown = {"no record", "The page has no share.hash to compare with"},
  upToDate = {"up to date", "The remote has what a share would send"},
  remoteChanged = {"remote changed", "Only the remote changed"},
  differs = {"differs", "Differs from the remote; sharing would write it"},
  missing = {"missing", "Not on the remote"},
  bothChanged = {"changed both sides", "Changed here and on the remote"},
  error = {"check failed", "The remote couldn't be read"},
  removed = {"removed", "On the remote, but no longer in the collection"},
}

-- Pull and sync pages differ only without a share.hash, and sharing them may
-- take the remote's version
local pullDiffers = {
  "differs",
  "Differs from the remote, and there's no share.hash to tell which side changed",
}

-- The last Check results, by row name, until an action on the row or a change
-- to its page's text: a page's or member's {result, text}, with the page's
-- text when checked; a collection's {removed}, the files a Check found on the
-- remote but not in the collection
local checks = {}

-- A group's folder comes from the tree, not from a row, so it has no kind
local function kindOf(obj)
  return obj.kind or "group"
end

-- A page's text, or nil when it can't be read (renamed or deleted before the
-- index caught up)
local function textOf(name)
  local ok, text = pcall(space.readPage, name)
  return ok and text or nil
end

-- Row name's Check result while page's text still holds, else offline()
local function statusOf(name, page, offline)
  local check = checks[name]
  if check and check.text != nil and check.text == textOf(page) then
    return check.result
  end
  return offline()
end

-- Forgets the Check results of a collection's folder and everything in it
local function forgetCollection(folder)
  local prefix = folder .. SEP
  local stale = {}
  for name in pairs(checks) do
    if name == folder or name:startsWith(prefix) then
      table.insert(stale, name)
    end
  end
  for _, name in ipairs(stale) do
    checks[name] = nil
  end
end

local function pageStatus(name)
  local ok, status = pcall(share.status, name)
  if ok then
    return status
  end
  return {state = "error", error = tostring(status)}
end

-- row with the status chip fields for a share in mode
local function withChip(row, mode, status)
  local label = statusLabels[status.state] or {}
  if status.state == "differs" and mode != "push" then
    label = pullDiffers
  end
  row.status = label[1]
  -- The mode only shows here, a second chip doesn't fit a sidebar row
  row.statusTitle = label[1] and (mode .. " · " .. (status.error or label[2]))
  return row
end

local function collectionFolder(name)
  return "Collections" .. SEP .. name
end

local function collectionRows(name)
  local folder = collectionFolder(name)
  local rows = {}
  local ok, err = pcall(function()
    local c = share.collection(name)
    table.insert(rows, {
      name = folder,
      label = name,
      kind = "collection",
      collection = name,
      root = c.root,
      count = #c.members,
    })
    for _, m in ipairs(c.members) do
      local rowName = folder .. SEP .. m.page
      table.insert(rows, withChip({
        name = rowName,
        page = m.page,
        uri = m.uri,
        mode = c.mode,
        kind = "member",
        collection = name,
      }, c.mode, statusOf(rowName, m.page, function()
        -- No chip until a Check: there is nothing to compare with offline
        return {}
      end)))
    end
    local check = checks[folder]
    for _, uri in ipairs(check and check.removed or {}) do
      table.insert(rows, withChip({
        -- Apart from the members' rows: no page name has a control character
        name = folder .. SEP .. "\x1e" .. uri,
        label = share.collectionLabel(c.root, uri),
        uri = uri,
        kind = "removed",
        collection = name,
      }, c.mode, {state = "removed"}))
    end
  end)
  if ok then
    return rows
  end
  return {
    {name = folder, label = name, kind = "collection", collection = name},
    {
      name = folder .. SEP .. "error",
      label = tostring(err),
      kind = "error",
      collection = name,
    },
  }
end

local function sharedRows()
  local byKind = {}
  for _, p in ipairs(share.list()) do
    byKind[p.kind] = byKind[p.kind] or {}
    table.insert(byKind[p.kind], p)
  end
  local rows = {}
  for _, group in ipairs(groups) do
    if group.kind == "collection" then
      for _, name in ipairs(share.collections()) do
        for _, row in ipairs(collectionRows(name)) do
          table.insert(rows, row)
        end
      end
    end
    for _, p in ipairs(byKind[group.kind] or {}) do
      local rowName = group.label .. SEP .. p.name
      table.insert(rows, withChip({
        name = rowName,
        page = p.name,
        uri = p.uri,
        mode = p.mode,
        kind = p.kind,
      }, p.mode, statusOf(rowName, p.name, function()
        return pageStatus(p.name)
      end)))
    end
  end
  return rows
end

local function pagesIn(groupLabel)
  local kind
  for _, group in ipairs(groups) do
    if group.label == groupLabel then
      kind = group.kind
    end
  end
  local names = {}
  for _, p in ipairs(share.list()) do
    if p.kind == kind then
      table.insert(names, p.name)
    end
  end
  return names
end

local function checkGroup(groupLabel)
  local names = pagesIn(groupLabel)
  local texts = {}
  for _, name in ipairs(names) do
    texts[name] = textOf(name)
  end
  for name, result in pairs(share.check(names)) do
    checks[groupLabel .. SEP .. name] = {result = result, text = texts[name]}
  end
end

-- A collection that can't be checked (say its listing needs a sign-in) shows
-- the error on every member
local function checkCollection(name)
  local c = share.collection(name)
  local texts = {}
  for _, m in ipairs(c.members) do
    texts[m.page] = textOf(m.page)
  end
  local ok, result = pcall(share.checkCollection, name)
  if not ok then
    local members = {}
    for _, m in ipairs(c.members) do
      members[m.page] = {uri = m.uri, state = "error", error = tostring(result)}
    end
    result = {members = members, removed = {}}
  end
  local folder = collectionFolder(name)
  forgetCollection(folder)
  checks[folder] = {removed = result.removed}
  for page, checked in pairs(result.members) do
    checks[folder .. SEP .. page] = {result = checked, text = texts[page]}
  end
end

local function isKind(...)
  local kinds = {...}
  return function(obj)
    for _, kind in ipairs(kinds) do
      if kindOf(obj) == kind then
        return true
      end
    end
    return false
  end
end

-- A group's folder, or a collection's (also one without members, which the
-- tree doesn't mark as a folder)
local isFolder = isKind("group", "collection")

-- An action on a page, which forgets that page's Check result (a member's is
-- the collection's, forgotten by Share Collection)
local function onPage(fn)
  return function(obj)
    if obj.kind != "member" then
      checks[obj.name] = nil
    end
    fn(obj)
  end
end

local function statusChip(obj)
  if obj.status then
    return {{text = obj.status, title = obj.statusTitle}}
  end
end

-- By kind; the rest show their status chip, if any
local decorations = {
  -- One that couldn't be resolved has no root
  collection = function(obj)
    if obj.root then
      local pages = obj.count == 1 and " page" or " pages"
      -- The count first: chips that don't fit drop from the end
      return {{text = obj.count .. pages}, {text = obj.root}}
    end
  end,
}

view.define {
  name = "std.sharedPages",
  title = "Shared Pages",
  command = "Navigate: Shared Pages",
  dock = "rhs",
  supportedDocks = {"rhs", "lhs", "bhs", "modal"},
  refreshOnOpen = true,
  source = sharedRows,
  presentation = {
    mode = "tree",
    hierarchy = {field = "name", separator = SEP},
    expandAll = true,
    foldersFirst = false,
    row = {
      label = function(obj)
        return obj.label or obj.page or obj.name
      end,
      decorations = function(obj)
        return (decorations[kindOf(obj)] or statusChip)(obj)
      end,
      icon = function(obj)
        return icons[kindOf(obj)]
      end,
    },
  },
  actions = {
    {
      icon = "refresh-cw",
      label = "Check",
      -- A read-only server reaches no remotes
      requireMode = "rw",
      when = isFolder,
      run = function(obj)
        if kindOf(obj) == "collection" then
          checkCollection(obj.collection)
        elseif obj.name == "Collections" then
          -- One that can't be resolved already shows its error
          for _, name in ipairs(share.collections()) do
            pcall(checkCollection, name)
          end
        else
          checkGroup(obj.name)
        end
      end,
    },
    {
      icon = "upload",
      label = "Share",
      requireMode = "rw",
      when = isKind("page"),
      run = onPage(function(obj)
        share.notifyShared(pcall(share.sharePage, obj.page))
      end),
    },
    {
      icon = "upload-cloud",
      label = "Share Collection",
      requireMode = "rw",
      when = isKind("collection"),
      run = function(obj)
        forgetCollection(obj.name)
        share.notifyPublished(obj.collection,
          pcall(share.publishCollection, obj.collection))
      end,
    },
    {
      icon = "external-link",
      label = "Open Remote",
      when = isKind("page", "member"),
      run = onPage(function(obj)
        share.openRemote(obj.uri)
      end),
    },
    {
      icon = "link",
      label = "Copy Link",
      when = isKind("page", "member"),
      run = onPage(function(obj)
        share.copyLink(obj.uri)
      end),
    },
    {
      icon = "download",
      label = "Update",
      requireMode = "rw",
      when = isKind("library", "repository"),
      run = onPage(function(obj)
        editor.invokeCommand("Library: Update", {{name = obj.page}})
      end),
    },
    {
      icon = "package",
      label = "Open in Libraries tab",
      when = isKind("library", "repository"),
      run = function()
        editor.invokeCommand("Workbench: Libraries")
      end,
    },
  },
  onSelect = function(obj)
    if obj.page then
      editor.navigate(obj.page)
    end
  end,
}
```
