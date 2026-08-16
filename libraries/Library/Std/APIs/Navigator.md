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

-- navigator.pick registers its ephemeral, one-shot views under a name in this
-- namespace, so navigator.define has to keep out of it.
local RESERVED_PICK_PREFIX = "__pick:"

-- Claimed by built-in navigation, so a view can't rebind them.
local reservedKeys = {
  ArrowUp = true, ArrowDown = true, ArrowLeft = true, ArrowRight = true,
  Enter = true, Escape = true, PageUp = true, PageDown = true,
  Home = true, End = true,
  -- Tab steps through the segments, and is swallowed by a view that
  -- has none: focus must never leave the filter input.
  Tab = true,
}

-- Strings here are JS strings, so `#s` counts UTF-16 units: a surrogate pair
-- (an emoji, say) is one character in two of them.
local function charCount(s)
  local count, i = 0, 1
  while i <= #s do
    local unit = string.byte(s, i)
    if unit >= 0xD800 and unit <= 0xDBFF then i = i + 2 else i = i + 1 end
    count = count + 1
  end
  return count
end

-- A prefix has to be one character the user can actually type, and it has to
-- be the only thing in the view claiming it -- otherwise "what does typing $
-- do here" has more than one answer.
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

-- Which sibling view each character routes to. Unlike a segment prefix (a
-- subset of the same rows), this hands the slot to a different view whole.
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
  -- An empty table would cross to the panel as an object with no keys, which
  -- is harmless but says "this view routes" when it doesn't.
  if not any then return nil end
  return out
end

-- Every prefix character the view claims, from both mechanisms, checked as one
-- namespace -- and against the keymap, which claims characters too.
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
  -- A character claimed by both would be a coin flip the user can't see: a
  -- printable keymap key fires while navigating, a prefix fires on an empty
  -- phrase while typing, and nothing on screen says which mode you are in.
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
  -- An empty table crosses to the panel as an object, not an array, and every
  -- `includes`/`some` on the other side would throw on it.
  if #keys == 0 then return nil end
  return keys
end

-- A bare Feather name ("lock"), a namespaced one ("feather:lock"), or literal
-- SVG markup (a string starting with "<svg") -- always a string. Which of the
-- three it is gets sniffed client-side (see engine.ts's parseIcon), not here;
-- anything that isn't a string would cross to the panel and quietly draw
-- nothing, so it's rejected at definition time.
local function validateIcon(icon, what)
  if icon == nil then return end
  if type(icon) == "string" then return end
  error("navigator.define: " .. what .. " must be an icon name (\"lock\"), " ..
    "a namespaced name (\"feather:lock\"), or literal SVG markup " ..
    "(a string starting with \"<svg\")")
end

-- Like validateIcon, but presentation.row.icon also accepts a function (an
-- icon computed per object) -- what it returns at runtime isn't known here,
-- so the "rowState" hook (luaHandlers.rowState below) is what actually
-- enforces the string contract on a function's result (a non-string return
-- there just leaves the row without an icon, silently, same as a nil one).
local function validateRowIcon(icon, what)
  if icon == nil then return end
  if type(icon) == "string" then return end
  if type(icon) == "function" then return end
  error("navigator.define: " .. what .. " must be an icon name (\"lock\"), " ..
    "a namespaced name (\"feather:lock\"), literal SVG markup " ..
    "(a string starting with \"<svg\"), or a function returning one")
end

-- Everything the panel needs to draw a row's actions; `run`/`when` stay here.
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

-- Everything the panel needs to draw the segments; `where` stays here.
local function segmentMeta(spec)
  if not spec.segments then return nil end
  local out = {}
  local seen = {}
  for i, segment in ipairs(spec.segments) do
    if type(segment.label) ~= "string" or segment.label == "" then
      error("navigator.define: segments[" .. i .. "] requires a label")
    end
    -- The label is the key the active segment is persisted under, so two of
    -- them would restore ambiguously.
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

-- Trees start collapsed; this makes them start open, which inverts what the
-- panel's persisted set means (it then holds what you closed). Tree-only: in a
-- list there is nothing to expand, so accepting it there would silently mean
-- nothing.
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

-- What a tree's expansion state belongs to. "view" (the default) is right when
-- the paths are globally unique; "page" is for a tree of the current page's
-- own content, whose paths mean nothing on any other page -- there the state
-- is kept only while you are on that page.
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

-- Where the view opens. An unknown dock would be handed to the client as a
-- panel slot that doesn't exist, which shows nothing and says nothing.
local function dockSlot(spec)
  if spec.dock == nil then return "modal" end
  if spec.dock ~= "modal" and spec.dock ~= "lhs" and spec.dock ~= "rhs" then
    error("navigator.define: dock must be \"modal\", \"lhs\" or \"rhs\"")
  end
  return spec.dock
end

-- List or tree. Anything else would quietly render as a list, taking the
-- tree-only options (which are validated against *this*) down with it.
local function presentationMode(spec)
  local mode = (spec.presentation or {}).mode
  if mode == nil then return "list" end
  if mode ~= "list" and mode ~= "tree" then
    error("navigator.define: presentation.mode must be \"list\" or \"tree\"")
  end
  return mode
end

-- What nests a tree's rows. A malformed table (`{}`, say) would leave the
-- panel without a separator, and every row at the root of a flat "tree".
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

-- The events that re-run the source, on top of the ones the panel always
-- listens for. No default: a view that wants liveness declares its own
-- events. `{}` is a plausible spelling of "no refresh, thanks" and has to
-- become `nil` to mean it: see keymapKeys, and the plug spreads this list.
local function refreshOnEvents(spec)
  if spec.refreshOn == nil then return nil end
  if type(spec.refreshOn) ~= "table" then
    error("navigator.define: refreshOn must be a list of event names")
  end
  if #spec.refreshOn == 0 then return nil end
  return spec.refreshOn
end

-- What the phrase is matched against. An empty map is *not* the same as none:
-- the panel would rank every row against zero fields, score them all 0, and
-- empty the list on the first keystroke -- so it is treated as absent.
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

-- Everything the panel needs to draw and open this view, built once at
-- registration time (not per activation) and pushed to the plug's registry
-- below -- `navigator.handle`'s "meta" hook just hands this straight back.
local function wireMeta(spec)
  local p = spec.presentation or {}
  local f = spec.filter or {}
  return {
    name = spec.name,
    title = spec.title or spec.name,
    -- Picker chrome: a verb in place of the title, and a placeholder naming
    -- what is being picked. A docked view can set both too -- they just
    -- default to unset.
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

-- Everything navigator.define and navigator.pick both check: the "content"
-- fields (source, filter, segments, presentation, the interaction handlers)
-- that make a view a view, regardless of whether it also has a name a
-- command can open. `caller` is only for error messages -- so a bad
-- `presentation.row.icon` in a navigator.pick spec still names the field
-- correctly, even though the validators below are shared code.
--
-- Validation only -- does not touch `navigator._views` or push to the plug's
-- registry. Callers do both themselves, in that order, once this returns
-- without erroring (see navigator.define/navigator.pick).
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
  -- A modal has nowhere to stay open, so booting one would be a modal in the
  -- user's face on every load.
  if spec.openOnStart == true and spec.dock ~= "lhs" and spec.dock ~= "rhs" then
    error("navigator.define: openOnStart requires dock \"lhs\" or \"rhs\"")
  end
  registerViewSpec(spec, "navigator.define")
  -- Synchronous from this call's point of view: a name colliding with a
  -- built-in throws here (`registry.ts`'s `register`), surfacing at
  -- `navigator.define` time rather than as a silent no-op -- before
  -- `navigator._views` is touched, so a rejected define never leaves the
  -- two registries disagreeing.
  system.invokeFunction("navigator.register", { meta = wireMeta(spec) })
  navigator._views[spec.name] = spec
  if spec.command then
    command.define {
      name = spec.command,
      key = spec.key,
      mac = spec.mac,
      -- Desktop-app native menus render off these; they travel with whichever
      -- command holds the key binding (see [[#Built-in views]]).
      menu = spec.menu,
      menuMac = spec.menuMac,
      menuWindows = spec.menuWindows,
      menuLinux = spec.menuLinux,
      hide = spec.hide,
      -- Returning false stops the client from refocusing the editor once the
      -- command resolves; the panel focuses its own filter input instead.
      -- Only on the success path -- a failed open leaves no panel to hold
      -- focus, so the editor should keep it.
      run = function()
        if navigator.open(spec.name) then return false end
      end,
    }
  end
end

-- Fields that only mean something once a view has a name of its own: a
-- command to bind, chrome to remember, a dock to stay open in, or (prefixViews)
-- a way for *other* views to reach this one by name. A pick has none of
-- that -- it's a step in the caller's own flow, not a thing other code
-- opens by name -- so these are rejected outright rather than silently
-- ignored, pointing whoever reaches for one of them at navigator.define.
local pickRejectedFields = {
  "name", "command", "key", "mac", "menu", "menuMac", "menuWindows",
  "menuLinux", "hide", "dock", "openOnStart", "refreshOn", "refreshOnOpen",
  "followEditor", "onMove", "prefixViews",
}

-- The content fields navigator.pick carries over onto its ephemeral spec, as
-- opposed to computing/wrapping (`onSelect`, `name`, `dock`) or refusing
-- outright (see pickRejectedFields).
local pickContentFields = {
  "source", "filter", "segments", "presentation", "placeholder", "title",
  "label", "search", "onCreate", "actions", "keymap",
}

local pickCounter = 0

-- Collision-proof: `pickCounter` alone would restart at 0 whenever the
-- surrounding Space Lua env is rebuilt (a full reindex, first sync, or the
-- initial index landing) while a plug-worker-side `pendingPicks` entry from
-- before the rebuild is still live -- an old pick's resolver would then be
-- silently overwritten by a new one minting the same name. The random
-- component makes that practically impossible regardless of when the env
-- last rebuilt (math.random's PRNG is seeded once, from wall-clock/perf
-- entropy, at module load -- not reset by an env rebuild), so the counter is
-- there only to keep concurrent names readable/orderable, not for uniqueness.
local function nextPickName()
  pickCounter = pickCounter + 1
  return RESERVED_PICK_PREFIX .. tostring(pickCounter) .. ":" .. tostring(math.random(0))
end

--- Opens a one-shot modal picker and returns the selected row's object, or
--- nil if it was dismissed (Escape, backdrop), superseded by a newer open
--- before anything was picked, or the panel's own plug worker restarted out
--- from under it (`Plugs: Reload` and similar). Accepts the same content
--- fields as navigator.define (source required; filter, segments,
--- presentation, placeholder, title, label, search, onCreate, actions,
--- keymap) -- see [[API/navigator#navigator.pick(spec)]] for the full field
--- reference.
function navigator.pick(spec)
  if type(spec) ~= "table" then error("navigator.pick: spec must be a table") end
  for _, field in ipairs(pickRejectedFields) do
    if spec[field] ~= nil then
      error("navigator.pick: '" .. field .. "' is a navigator.define field " ..
        "(a name, command chrome, or docking field) -- navigator.pick " ..
        "doesn't take it; use navigator.define if this view needs one of its own")
    end
  end
  -- Reserved, ephemeral, and never exposed: nothing outside this function
  -- ever needs to know the name, only that it's unique for the run.
  local name = nextPickName()
  local internal = { name = name, dock = "modal", ephemeral = true }
  for _, field in ipairs(pickContentFields) do
    internal[field] = spec[field]
  end
  local userOnSelect = spec.onSelect
  internal.onSelect = function(obj, ctx)
    if userOnSelect then
      -- Unchanged semantics: false keeps the panel open, and the pick stays
      -- unresolved -- another row (or a dismissal) still has to settle it.
      if userOnSelect(obj, ctx) == false then return false end
    end
    system.invokeFunction("navigator.pickSettle", name, obj)
  end
  registerViewSpec(internal, "navigator.pick")
  navigator._views[name] = internal
  -- Suspends here until the plug resolves it: the row that was picked, or
  -- nil for a dismissal or a supersede (see navigator.ts's pickOpen/
  -- pickSettle and Escape/backdrop's route through panelHidden). Wrapped in
  -- pcall because the plug worker holding this open can be torn down out
  -- from under it (a `Plugs: Reload`, an unload/reload of the navigator plug
  -- specifically) -- `invoke` then rejects rather than ever resolving, and
  -- without the pcall that would surface as a raw thrown error instead of
  -- the nil a dismissal already means.
  --
  -- The registration itself rides along as this same call's payload
  -- (`pickOpen` registers before it opens) rather than a separate
  -- `navigator.register` round trip first: a `__pick:` name can never
  -- collide, so there is nothing a second trip could catch.
  local ok, result = pcall(
    system.invokeFunction, "navigator.pickOpen", name, wireMeta(internal)
  )
  -- Deregister regardless of how it resolved (or failed) -- the panel's own
  -- per-name cache is dropped independently, client-side, the moment this
  -- view stops being the active one for its slot (see engine.ts's
  -- dropIfEphemeral).
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
  -- Deliberately not checked against `navigator._views`: the built-in pickers
  -- live in the plug's own registry rather than this one (see
  -- [[#Built-in views]]), and the plug resolves both -- reporting a genuinely
  -- unknown name itself.
  return system.invokeFunction("navigator.open", name, opts)
end

-- The event bus swallows listener exceptions, so a failing user callback
-- would otherwise be invisible: no panel feedback, nothing in the UI.
local function runHandler(what, fn)
  local ok, result = pcall(fn)
  if not ok then
    editor.flashNotification("navigator " .. what .. ": " .. tostring(result), "error")
    return nil
  end
  return result
end

function navigator.moveByRename(obj, newName)
  -- folder rows carry isFolder (set by the tree UI)
  if obj.isFolder then
    -- Covers documents as well as pages under the prefix.
    system.invokeFunction("index.renamePrefixCommand", {
      oldPrefix = obj.name .. "/", newPrefix = newName .. "/", disableConfirmation = true,
    })
  end
  -- A page that also has children is both: renamePrefixCommand only touches
  -- files under "name/", so the page itself still needs its own rename.
  if not obj.isFolder or obj.ref then
    if obj.tag == "document" then
      -- A document's name carries its extension and is the file name itself,
      -- so the page rename (which appends ".md") would rename the wrong file.
      system.invokeFunction("index.renameDocumentCommand", {
        oldDocument = obj.name, document = newName,
      })
    else
      system.invokeFunction("index.renamePageCommand", { oldPage = obj.name, page = newName })
    end
  end
end

-- See keymapKeys: a `decorations` function returning `{}` for an undecorated
-- row -- which the worked examples above do -- would arrive at the panel as an
-- object, and the chips are drawn off an array.
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
      -- Tree mode only: what the row reads as, when that is not the last
      -- segment of the path nesting it.
      label = resolveField(row.label, obj),
      description = resolveField(row.description, obj),
      decorations = resolveDecorations(row.decorations, obj),
      cssClass = resolveField(row.cssClass, obj),
    }
  end
  return rows
end

-- One `navigator.handle` hook each, dispatched by `navigator:luaCall` below.
-- `meta` isn't here: the plug answers it straight from the `wireMeta` it
-- already has cached from registration, without asking Lua at all.
local luaHandlers = {}

luaHandlers.rows = function(spec, args)
  -- A Lua table of its own rather than the incoming JS object, so `source`
  -- always sees the same shape however the panel sent it.
  local incoming = args.ctx or {}
  local ctx = { phrase = incoming.phrase or "", segment = incoming.segment }
  -- Exceptions have to come back as data for the panel to be able to show
  -- them -- unlike the other hooks, a throwing source leaves nothing else on
  -- screen to fall back to.
  local ok, result = pcall(buildRows, spec, ctx)
  if not ok then return { error = tostring(result) } end
  return result
end

luaHandlers.select = function(spec, args)
  -- `from` is the view a prefixViews hop came from, so an onSelect can hand
  -- the slot back to it. Returning false is how it says "I took the panel
  -- over, don't close it".
  local ctx = { from = args.from }
  -- Always a function: navigator.define requires it, and navigator.pick
  -- wraps whatever the caller passed (nil included) into one of its own.
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
  -- The panel already hides these, but the click and the mode change could
  -- always have crossed in flight -- and this hook is reachable without the
  -- panel at all.
  if action.requireMode == "rw" and readOnlyMode() then
    editor.flashNotification(
      "navigator: " .. action.label .. " is unavailable in read-only mode", "error")
    return
  end
  runHandler("action", function()
    action.run(args.obj)
  end)
end

-- One pass over the whole batch, dispatched by the panel when its rows load
-- (never on hover, never per keystroke): every `when` predicate, every `where`
-- predicate and every row icon, for every object the panel may draw --
-- including the folder objects it synthesizes, which no `source` ever returns.
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
          -- A throwing predicate hides its action rather than taking down the
          -- whole pass with it.
          local ok, applies = pcall(action.when, obj)
          mask[j] = ok and applies == true
        end
      end
      entry.actions = mask
    end
    -- Source mode subsets in the source itself, off the label it is handed:
    -- its `where` predicates, if it has any, are never consulted.
    if spec.segments and searchMode(spec) ~= "source" then
      local mask = {}
      for j, segment in ipairs(spec.segments) do
        if segment.where == nil then
          -- No predicate: a pass-through segment.
          mask[j] = true
        else
          -- Fail-closed, same as `when`: a throwing predicate drops the row
          -- from its segment rather than taking down the pass.
          local ok, applies = pcall(segment.where, obj)
          mask[j] = ok and applies == true
        end
      end
      entry.segments = mask
    end
    if icon ~= nil then
      -- Unlike `row.primary`, a string here is the icon itself, not a field
      -- to read off the object.
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

-- The one hook-dispatch bridge event: every hook `navigator.handle`
-- (`registry.ts`) routes to a Lua-owned view lands here, keyed by
-- `e.data.hook`.
event.listen { name = "navigator:luaCall", run = function(e)
  local spec = navigator._views[e.data.view]
  if not spec then return nil end
  local handler = luaHandlers[e.data.hook]
  if not handler then return nil end
  return handler(spec, e.data.args or {})
end }

-- Lifecycle re-registration, not a hook-RPC stub -- the plug worker's own
-- `luaViews` (`registry.ts`) is in-memory, and `Plugs: Reload` (or any
-- server-side sandbox recycle) rebuilds that worker from scratch without
-- re-running Space Lua, so nothing else re-pushes what this space has
-- already defined. `pcall` per entry: a `__pick:` name is skipped outright
-- (its pick has long since finished, one way or another, by the time a
-- reload happens), and a stale entry under a name that would now collide
-- with a built-in must not abort the rest of the loop.
event.listen { name = "plugs:loaded", run = function()
  for name, spec in pairs(navigator._views) do
    if string.sub(name, 1, #RESERVED_PICK_PREFIX) ~= RESERVED_PICK_PREFIX then
      pcall(system.invokeFunction, "navigator.register", { meta = wireMeta(spec) })
    end
  end
end }
```
