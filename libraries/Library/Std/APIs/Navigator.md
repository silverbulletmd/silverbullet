---
description: APIs to define universal navigator views
tags: meta/api
---
APIs to define navigator views: filterable/tree panels (modal, left- or right-hand side) that list objects from a `source` query and let you select or (optionally) move them.

# Implementation
```space-lua
-- priority: 100
navigator = navigator or {}
navigator._views = navigator._views or {}

local RESERVED_PICK_PREFIX = "__pick:"

local reservedKeys = {
  ArrowUp = true, ArrowDown = true, ArrowLeft = true, ArrowRight = true,
  Enter = true, Escape = true, PageUp = true, PageDown = true,
  Home = true, End = true,
  Tab = true,
}

local function charCount(s)
  local count, i = 0, 1
  while i <= #s do
    local unit = string.byte(s, i)
    if unit >= 0xD800 and unit <= 0xDBFF then i = i + 2 else i = i + 1 end
    count = count + 1
  end
  return count
end

local function validatePrefix(char, what, claimed)
  if type(char) ~= "string" then
    error("navigator.define: " .. what .. " must be a string")
  end
  if charCount(char) ~= 1 then
    error("navigator.define: " .. what .. " must be exactly one character")
  end
  if string.match(char, "%s") or string.match(char, "%c") then
    error("navigator.define: " .. what .. " must be a printable character")
  end
  if claimed[char] then
    error("navigator.define: prefix '" .. char .. "' is claimed twice (" ..
      claimed[char] .. " and " .. what .. ")")
  end
  claimed[char] = what
end

local function prefixViewsMeta(spec)
  if spec.prefixViews == nil then return nil end
  if type(spec.prefixViews) ~= "table" then
    error("navigator.define: prefixViews must be a table")
  end
  local out, any = {}, false
  for char, name in pairs(spec.prefixViews) do
    if type(name) ~= "string" or name == "" then
      error("navigator.define: prefixViews['" .. tostring(char) ..
        "'] must be a view name")
    end
    out[char] = name
    any = true
  end
  if not any then return nil end
  return out
end

local function validatePrefixes(spec)
  local claimed = {}
  for i, segment in ipairs(spec.segments or {}) do
    if segment.prefix ~= nil then
      validatePrefix(segment.prefix, "segments[" .. i .. "].prefix", claimed)
    end
  end
  for char, _ in pairs(spec.prefixViews or {}) do
    validatePrefix(char, "prefixViews['" .. tostring(char) .. "']", claimed)
  end
  for key, _ in pairs(spec.keymap or {}) do
    if claimed[key] then
      error("navigator.define: '" .. key .. "' is both a keymap key and " ..
        claimed[key])
    end
  end
end

local function keymapKeys(spec)
  if not spec.keymap then return nil end
  local keys = {}
  for key, fn in pairs(spec.keymap) do
    if reservedKeys[key] then
      error("navigator.define: key '" .. key .. "' is reserved by built-in navigation")
    end
    if type(fn) ~= "function" then
      error("navigator.define: keymap['" .. key .. "'] must be a function")
    end
    keys[#keys + 1] = key
  end
  -- An empty table crosses to the panel as an object, not an array, and `.includes`/`.some` on the other side would throw on it.
  if #keys == 0 then return nil end
  return keys
end

local function validateIcon(icon, what)
  if icon == nil then return end
  if type(icon) == "string" then return end
  error("navigator.define: " .. what .. " must be an icon name (\"lock\"), " ..
    "a namespaced name (\"feather:lock\"), or literal SVG markup " ..
    "(a string starting with \"<svg\")")
end

-- The string contract for a function's return is enforced at runtime by the "rowState" hook below, not here -- what it returns isn't known until it runs.
local function validateRowIcon(icon, what)
  if icon == nil then return end
  if type(icon) == "string" then return end
  if type(icon) == "function" then return end
  error("navigator.define: " .. what .. " must be an icon name (\"lock\"), " ..
    "a namespaced name (\"feather:lock\"), literal SVG markup " ..
    "(a string starting with \"<svg\"), or a function returning one")
end

local function actionMeta(spec)
  if not spec.actions then return nil end
  local out = {}
  for i, action in ipairs(spec.actions) do
    if type(action.label) ~= "string" or action.label == "" then
      error("navigator.define: actions[" .. i .. "] requires a label")
    end
    if type(action.run) ~= "function" then
      error("navigator.define: actions[" .. i .. "].run must be a function")
    end
    if action.when ~= nil and type(action.when) ~= "function" then
      error("navigator.define: actions[" .. i .. "].when must be a function")
    end
    if action.requireMode ~= nil and action.requireMode ~= "rw" then
      error("navigator.define: actions[" .. i .. "].requireMode must be \"rw\"")
    end
    validateIcon(action.icon, "actions[" .. i .. "].icon")
    out[i] = {
      icon = action.icon,
      label = action.label,
      hasWhen = action.when ~= nil,
      requireMode = action.requireMode,
    }
  end
  -- See keymapKeys: an empty table would arrive as an object, not an array.
  if #out == 0 then return nil end
  return out
end

local function segmentMeta(spec)
  if not spec.segments then return nil end
  local out = {}
  local seen = {}
  for i, segment in ipairs(spec.segments) do
    if type(segment.label) ~= "string" or segment.label == "" then
      error("navigator.define: segments[" .. i .. "] requires a label")
    end
    if seen[segment.label] then
      error("navigator.define: duplicate segment label '" .. segment.label .. "'")
    end
    seen[segment.label] = true
    if segment.where ~= nil and type(segment.where) ~= "function" then
      error("navigator.define: segments[" .. i .. "].where must be a function")
    end
    validateIcon(segment.icon, "segments[" .. i .. "].icon")
    out[i] = {
      label = segment.label,
      icon = segment.icon,
      hasWhere = segment.where ~= nil,
      default = segment.default == true,
      prefix = segment.prefix,
      placeholder = segment.placeholder,
    }
  end
  -- See keymapKeys: an empty table would arrive as an object, not an array.
  if #out == 0 then return nil end
  return out
end

local function renderLimit(spec)
  local limit = (spec.presentation or {}).limit
  if limit == nil then return 200 end
  if type(limit) ~= "number" or limit < 1 or limit ~= math.floor(limit) then
    error("navigator.define: presentation.limit must be a positive integer")
  end
  return limit
end

local function expandAll(spec)
  local p = spec.presentation or {}
  if p.expandAll == nil then return false end
  if type(p.expandAll) ~= "boolean" then
    error("navigator.define: presentation.expandAll must be a boolean")
  end
  if p.expandAll and (p.mode or "list") ~= "tree" then
    error("navigator.define: presentation.expandAll requires mode \"tree\"")
  end
  return p.expandAll
end

local function expansionScope(spec)
  local p = spec.presentation or {}
  local scope = p.expansionScope
  if scope == nil then return "view" end
  if scope ~= "view" and scope ~= "page" then
    error("navigator.define: presentation.expansionScope must be \"view\" or \"page\"")
  end
  if scope == "page" and (p.mode or "list") ~= "tree" then
    error("navigator.define: presentation.expansionScope requires mode \"tree\"")
  end
  return scope
end

local function searchMode(spec)
  local mode = spec.search
  if mode == nil then return "client" end
  if mode ~= "client" and mode ~= "source" then
    error("navigator.define: search must be \"client\" or \"source\"")
  end
  return mode
end

local function dockSlot(spec)
  if spec.dock == nil then return "modal" end
  if spec.dock ~= "modal" and spec.dock ~= "lhs" and spec.dock ~= "rhs" then
    error("navigator.define: dock must be \"modal\", \"lhs\" or \"rhs\"")
  end
  return spec.dock
end

local function presentationMode(spec)
  local mode = (spec.presentation or {}).mode
  if mode == nil then return "list" end
  if mode ~= "list" and mode ~= "tree" then
    error("navigator.define: presentation.mode must be \"list\" or \"tree\"")
  end
  return mode
end

local function hierarchy(spec)
  local h = (spec.presentation or {}).hierarchy
  if h == nil then return { field = "name", separator = "/" } end
  if type(h) ~= "table" or type(h.field) ~= "string"
    or type(h.separator) ~= "string" then
    error("navigator.define: presentation.hierarchy must be " ..
      "{ field = <string>, separator = <string> }")
  end
  return h
end

-- `{}` is a plausible spelling of "no refresh, thanks" and has to become `nil` to mean it: see keymapKeys.
local function refreshOnEvents(spec)
  if spec.refreshOn == nil then return nil end
  if type(spec.refreshOn) ~= "table" then
    error("navigator.define: refreshOn must be a list of event names")
  end
  if #spec.refreshOn == 0 then return nil end
  return spec.refreshOn
end

-- An empty map is *not* the same as none: the panel would rank every row against zero fields, score them all 0, and empty the list on the first keystroke.
local function filterFields(spec)
  local fields = spec.filter and spec.filter.fields
  if fields == nil then return nil end
  if type(fields) ~= "table" then
    error("navigator.define: filter.fields must be a table")
  end
  local any = false
  for _field, _weight in pairs(fields) do any = true end
  if not any then return nil end
  return fields
end

local function readOnlyMode()
  return system.getMode() == "ro" or editor.getUiOption("forcedROMode") == true
end

local function wireMeta(spec)
  local p = spec.presentation or {}
  local f = spec.filter or {}
  return {
    name = spec.name,
    title = spec.title or spec.name,
    label = spec.label,
    placeholder = spec.placeholder,
    stripPrefix = f.stripPrefix,
    createIcon = p.createIcon,
    mode = presentationMode(spec),
    dock = dockSlot(spec),
    hierarchy = hierarchy(spec),
    foldersFirst = p.foldersFirst ~= false,
    expandAll = expandAll(spec),
    expansionScope = expansionScope(spec),
    filterFields = filterFields(spec),
    followEditor = spec.followEditor == true,
    refreshOn = refreshOnEvents(spec),
    hasMove = spec.onMove ~= nil,
    hasCreate = spec.onCreate ~= nil,
    refreshOnOpen = spec.refreshOnOpen == true,
    keys = keymapKeys(spec),
    actions = actionMeta(spec),
    segments = segmentMeta(spec),
    limit = renderLimit(spec),
    search = searchMode(spec),
    hasRowIcon = (p.row or {}).icon ~= nil,
    prefixViews = prefixViewsMeta(spec),
    pathCompletion = f.pathCompletion == true,
    hashtagFilter = f.hashtagFilter == true,
    ephemeral = spec.ephemeral == true,
    openOnStart = spec.openOnStart == true,
  }
end

-- Validation only -- callers touch `navigator._views` and push to the registry themselves, in that order, once this returns without erroring.
local function registerViewSpec(spec, caller)
  if not spec.name then error(caller .. ": name is required") end
  if not spec.source then error(caller .. ": source is required") end
  validateIcon((spec.presentation or {}).createIcon, "presentation.createIcon")
  validateRowIcon(((spec.presentation or {}).row or {}).icon, "presentation.row.icon")
  keymapKeys(spec)
  actionMeta(spec)
  segmentMeta(spec)
  prefixViewsMeta(spec)
  validatePrefixes(spec)
  renderLimit(spec)
  searchMode(spec)
  dockSlot(spec)
  presentationMode(spec)
  hierarchy(spec)
  refreshOnEvents(spec)
  filterFields(spec)
  expandAll(spec)
  expansionScope(spec)
end

function navigator.define(spec)
  if type(spec.name) == "string" and
    string.sub(spec.name, 1, #RESERVED_PICK_PREFIX) == RESERVED_PICK_PREFIX then
    error("navigator.define: names starting with '" .. RESERVED_PICK_PREFIX ..
      "' are reserved for navigator.pick")
  end
  if type(spec.onSelect) ~= "function" then
    error("navigator.define: onSelect is required")
  end
  if (spec.key or spec.mac) and not spec.command then
    error("navigator.define: key/mac require command")
  end
  if spec.openOnStart == true and spec.dock ~= "lhs" and spec.dock ~= "rhs" then
    error("navigator.define: openOnStart requires dock \"lhs\" or \"rhs\"")
  end
  registerViewSpec(spec, "navigator.define")
  -- Throws here before `navigator._views` is touched, so a rejected define never leaves the two registries disagreeing.
  system.invokeFunction("navigator.register", { meta = wireMeta(spec) })
  navigator._views[spec.name] = spec
  if spec.command then
    command.define {
      name = spec.command,
      key = spec.key,
      mac = spec.mac,
      menu = spec.menu,
      menuMac = spec.menuMac,
      menuWindows = spec.menuWindows,
      menuLinux = spec.menuLinux,
      hide = spec.hide,
      run = function()
        if navigator.open(spec.name) then return false end
      end,
    }
  end
end

local pickRejectedFields = {
  "name", "command", "key", "mac", "menu", "menuMac", "menuWindows",
  "menuLinux", "hide", "dock", "openOnStart", "refreshOn", "refreshOnOpen",
  "followEditor", "onMove", "prefixViews",
}

local pickContentFields = {
  "source", "filter", "segments", "presentation", "placeholder", "title",
  "label", "search", "onCreate", "actions", "keymap",
}

local pickCounter = 0

-- `pickCounter` alone would restart at 0 on an env rebuild while an old pending pick is still live, silently colliding names -- the random component is what actually guarantees uniqueness.
local function nextPickName()
  pickCounter = pickCounter + 1
  return RESERVED_PICK_PREFIX .. tostring(pickCounter) .. ":" .. tostring(math.random(0))
end

function navigator.pick(spec)
  if type(spec) ~= "table" then error("navigator.pick: spec must be a table") end
  for _, field in ipairs(pickRejectedFields) do
    if spec[field] ~= nil then
      error("navigator.pick: '" .. field .. "' is a navigator.define field " ..
        "(a name, command chrome, or docking field) -- navigator.pick " ..
        "doesn't take it; use navigator.define if this view needs one of its own")
    end
  end
  local name = nextPickName()
  local internal = { name = name, dock = "modal", ephemeral = true }
  for _, field in ipairs(pickContentFields) do
    internal[field] = spec[field]
  end
  local userOnSelect = spec.onSelect
  internal.onSelect = function(obj, ctx)
    if userOnSelect then
      if userOnSelect(obj, ctx) == false then return false end
    end
    system.invokeFunction("navigator.pickSettle", name, obj)
  end
  registerViewSpec(internal, "navigator.pick")
  navigator._views[name] = internal
  -- Wrapped in `pcall` because the plug worker holding this open can be torn down mid-call (a `Plugs: Reload`) -- `invoke` then rejects, and without `pcall` that would surface as a raw error instead of the nil a dismissal already means.
  local ok, result = pcall(
    system.invokeFunction, "navigator.pickOpen", name, wireMeta(internal)
  )
  navigator._views[name] = nil
  if not ok then return nil end
  return result
end

function navigator.open(name, opts)
  if type(name) == "string" and
    string.sub(name, 1, #RESERVED_PICK_PREFIX) == RESERVED_PICK_PREFIX then
    error("navigator.open: '" .. name .. "' is a navigator.pick view -- " ..
      "it can only be opened by the navigator.pick call that registered it")
  end
  if opts ~= nil and type(opts) ~= "table" then
    error("navigator.open: opts must be a table")
  end
  -- Deliberately not checked against `navigator._views`: built-ins live only in the plug's own registry, and the plug already resolves and reports both.
  return system.invokeFunction("navigator.open", name, opts)
end

-- The event bus swallows listener exceptions, so without this a failing user callback would be invisible -- no panel feedback, nothing in the UI.
local function runHandler(what, fn)
  local ok, result = pcall(fn)
  if not ok then
    editor.flashNotification("navigator " .. what .. ": " .. tostring(result), "error")
    return nil
  end
  return result
end

function navigator.moveByRename(obj, newName)
  if obj.isFolder then
    system.invokeFunction("index.renamePrefixCommand", {
      oldPrefix = obj.name .. "/", newPrefix = newName .. "/", disableConfirmation = true,
    })
  end
  -- A page that also has children needs both: renamePrefixCommand only touches files under "name/", so the page itself still needs its own rename.
  if not obj.isFolder or obj.ref then
    if obj.tag == "document" then
      -- A document's name already carries its extension, so the page rename (which appends ".md") would target the wrong file.
      system.invokeFunction("index.renameDocumentCommand", {
        oldDocument = obj.name, document = newName,
      })
    else
      system.invokeFunction("index.renamePageCommand", { oldPage = obj.name, page = newName })
    end
  end
end

-- See keymapKeys: a `decorations` function returning `{}` for an undecorated row would arrive at the panel as an object, and the chips are drawn off an array.
local function resolveDecorations(fn, obj)
  if fn == nil then return nil end
  local out = fn(obj)
  if type(out) ~= "table" or #out == 0 then return nil end
  return out
end

local function resolveField(fieldOrFn, obj)
  if fieldOrFn == nil then return nil end
  if type(fieldOrFn) == "function" then return fieldOrFn(obj) end
  return obj[fieldOrFn]
end

local function buildRows(spec, ctx)
  local p = spec.presentation or {}
  local row = p.row or {}
  local objs = spec.source(ctx)
  local rows = {}
  for _, obj in ipairs(objs) do
    rows[#rows + 1] = {
      obj = obj,
      primary = resolveField(row.primary, obj) or obj.name or obj.ref,
      label = resolveField(row.label, obj),
      description = resolveField(row.description, obj),
      decorations = resolveDecorations(row.decorations, obj),
      cssClass = resolveField(row.cssClass, obj),
    }
  end
  return rows
end

local luaHandlers = {}

luaHandlers.rows = function(spec, args)
  local incoming = args.ctx or {}
  local ctx = { phrase = incoming.phrase or "", segment = incoming.segment }
  -- Exceptions come back as data here (not flashed): unlike the other hooks, a throwing source leaves nothing else on screen to fall back to.
  local ok, result = pcall(buildRows, spec, ctx)
  if not ok then return { error = tostring(result) } end
  return result
end

luaHandlers.select = function(spec, args)
  local ctx = { from = args.from }
  return runHandler("onSelect", function() return spec.onSelect(args.obj, ctx) end)
end

luaHandlers.create = function(spec, args)
  if not spec.onCreate then return end
  runHandler("onCreate", function() spec.onCreate(args.phrase) end)
end

luaHandlers.key = function(spec, args)
  local fn = spec.keymap and spec.keymap[args.key]
  if not fn then return end
  runHandler("keymap", function() fn(args.obj) end)
end

luaHandlers.action = function(spec, args)
  local action = spec.actions and spec.actions[args.index]
  if not action then return end
  -- The panel already hides these, but the click and a mode change could have crossed in flight, and this hook is reachable without the panel at all.
  if action.requireMode == "rw" and readOnlyMode() then
    editor.flashNotification(
      "navigator: " .. action.label .. " is unavailable in read-only mode", "error")
    return
  end
  runHandler("action", function()
    action.run(args.obj)
  end)
end

luaHandlers.rowState = function(spec, args)
  local icon = (spec.presentation or {}).row
  icon = icon and icon.icon
  local out = {}
  for i, obj in ipairs(args.objs) do
    local entry = {}
    if spec.actions then
      local mask = {}
      for j, action in ipairs(spec.actions) do
        if action.when == nil then
          mask[j] = true
        else
          local ok, applies = pcall(action.when, obj)
          mask[j] = ok and applies == true
        end
      end
      entry.actions = mask
    end
    if spec.segments and searchMode(spec) ~= "source" then
      local mask = {}
      for j, segment in ipairs(spec.segments) do
        if segment.where == nil then
          mask[j] = true
        else
          local ok, applies = pcall(segment.where, obj)
          mask[j] = ok and applies == true
        end
      end
      entry.segments = mask
    end
    if icon ~= nil then
      -- Unlike `row.primary`, a string here is the icon itself, not a field name to read off the object.
      local ok, value = pcall(function()
        if type(icon) == "function" then return icon(obj) end
        return icon
      end)
      if ok and type(value) == "string" then
        entry.icon = value
      end
    end
    out[i] = entry
  end
  return out
end

luaHandlers.move = function(spec, args)
  if not spec.onMove then return end
  runHandler("onMove", function() spec.onMove(args.obj, args.newName) end)
end

event.listen { name = "navigator:luaCall", run = function(e)
  local spec = navigator._views[e.data.view]
  if not spec then return nil end
  local handler = luaHandlers[e.data.hook]
  if not handler then return nil end
  return handler(spec, e.data.args or {})
end }

-- The plug worker's `luaViews` registry is in-memory and lost on a `Plugs: Reload` -- nothing else re-pushes what this space already defined, so this re-registers everything from Space Lua's own copy.
event.listen { name = "plugs:loaded", run = function()
  for name, spec in pairs(navigator._views) do
    if string.sub(name, 1, #RESERVED_PICK_PREFIX) ~= RESERVED_PICK_PREFIX then
      pcall(system.invokeFunction, "navigator.register", { meta = wireMeta(spec) })
    end
  end
end }
```
