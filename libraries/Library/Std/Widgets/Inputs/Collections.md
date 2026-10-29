---
description: List editing and chips for tags, identities and references.
tags: meta
---
List editing and chips for tags, identities and references. Internal implementation of [[Library/Std/Widgets/Inputs]].

```space-lua
-- priority: 35
widgets = widgets or {}
local linkTarget = widgets.inputCompletion.linkTarget
local filterOptions = widgets.inputCompletion.filterOptions
local refCandidates = widgets.inputCompletion.refCandidates
local tagNames = widgets.inputCompletion.tagNames

local dropdown = widgets.inputMenus.dropdown

local plainText = widgets.inputText.plainText
local textArea = widgets.inputText.textArea
local linkField = widgets.inputText.linkField
local editField = widgets.inputText.editField
local placeCaretAtEnd = widgets.inputText.placeCaretAtEnd
local autogrow = widgets.inputText.autogrow
local enterAction = widgets.inputText.enterAction

local function preventDefault(e) e.preventDefault() end
local function copy(list)
  local out = {}
  for i, v in ipairs(list or {}) do out[i] = v end
  return out
end

local function moveItem(list, i, delta)
  local out = copy(list)
  local j = i + delta
  if j < 1 or j > #out then return out end
  out[i], out[j] = out[j], out[i]
  return out
end

local function insertItem(list, i, value)
  local out = copy(list)
  table.insert(out, i, value)
  return out
end

local function removeItem(list, i)
  local out = copy(list)
  table.remove(out, i)
  return out
end

--- A list of strings, one text field per item, with a per-item menu and "+ add item". Enter adds an item below; Shift-Enter inserts a newline.
--- @param opts table { value?: string[], onChange: function(list), readOnly?: boolean, placeholder?: string, links?: boolean (default true) }
--- @return table an inline widget
--- @see API/widgets
function widgets.listInput(opts)
  local values = {}
  for _, v in ipairs(opts.value or {}) do table.insert(values, tostring(v)) end
  local links = opts.links ~= false
  if opts.readOnly then
    local lines = {}
    for _, v in ipairs(values) do table.insert(lines, plainText(v, opts.links)) end
    return dom.div { class = "sb-in-list", lines }
  end

  -- Shared by every handler of this widget. Handlers can interleave, so an
  -- entry is found by identity right before it's used, never by a saved index
  local entries = {}
  local committed = values
  for _, v in ipairs(values) do table.insert(entries, { value = v }) end
  if #entries == 0 then table.insert(entries, { value = "" }) end

  local itemsNode = dom.div { class = "sb-in-list-items" }

  local function indexOf(entry)
    for i, e in ipairs(entries) do
      if e == entry then return i end
    end
    return nil
  end

  local function commit()
    local now = {}
    for _, e in ipairs(entries) do
      if e.value ~= "" then table.insert(now, e.value) end
    end
    local same = #now == #committed
    for i = 1, #now do
      if now[i] ~= committed[i] then same = false end
    end
    if same then return end
    committed = now
    opts.onChange(#now > 0 and now or nil)
  end

  local itemNode

  local function render(focus)
    local nodes = {}
    for i, e in ipairs(entries) do
      e.node = e.node or itemNode(e)
      nodes[i] = e.node
    end
    itemsNode.replaceChildren(table.unpack(nodes))
    if focus and focus.ta then
      editField(focus.ta)
      focus.ta.focus()
      placeCaretAtEnd(focus.ta)
      autogrow(focus.ta)
    end
  end

  local function sync(entry)
    entry.value = entry.ta.value
  end

  local function move(entry, delta)
    local i = indexOf(entry)
    if not i then return end
    sync(entry)
    entries = moveItem(entries, i, delta)
    render(entry)
    commit()
  end

  local function insertBelow(entry)
    local i = indexOf(entry)
    if not i then return end
    local new = { value = "" }
    entries = insertItem(entries, i + 1, new)
    render(new)
    commit()
  end

  local function remove(entry, focusPrevious)
    local i = indexOf(entry)
    if not i then return end
    entries = removeItem(entries, i)
    local focus = focusPrevious and (entries[i - 1] or entries[i]) or nil
    render(focus)
    commit()
  end

  itemNode = function(entry)
    local ta, completion = textArea {
      value = entry.value,
      placeholder = opts.placeholder,
      links = links,
      onCommit = function(text)
        entry.value = text
        commit()
      end,
      onKey = function(e)
        local key = e.key
        if enterAction(e) == "commit" then
          e.preventDefault()
          sync(entry)
          insertBelow(entry)
          return true
        end
        if key == "Backspace" and entry.ta.value == "" and #entries > 1 then
          e.preventDefault()
          remove(entry, true)
          return true
        end
        if e.altKey and (key == "ArrowUp" or key == "ArrowDown") then
          e.preventDefault()
          move(entry, key == "ArrowUp" and -1 or 1)
          return true
        end
        return false
      end,
    }
    entry.ta = ta
    -- An item left empty goes away, unless it's the only one
    ta.addEventListener("blur", function()
      js.window.setTimeout(function()
        if js.window.document.activeElement == ta then return end
        if ta.value == "" and entry.value == "" and #entries > 1 then
          local i = indexOf(entry)
          if i then
            entries = removeItem(entries, i)
            render()
          end
        end
      end, 0)
    end)
    local actions = widgets.menu {
      title = "Item actions",
      keepFocus = true,
      items = function()
        local i = indexOf(entry) or 0
        local items = {}
        if i > 1 then
          table.insert(items, { label = "Move up", onSelect = function() move(entry, -1) end })
        end
        if i < #entries then
          table.insert(items, { label = "Move down", onSelect = function() move(entry, 1) end })
        end
        table.insert(items, { label = "Insert below", onSelect = function() insertBelow(entry) end })
        table.insert(items, { label = "Remove", danger = true, onSelect = function() remove(entry) end })
        return items
      end,
    }
    return dom.div {
      class = { "sb-in-list-item", "sb-in-menu-owner" },
      links and linkField(ta, completion) or ta,
      actions,
    }
  end

  render()
  return dom.div {
    class = "sb-in-list",
    itemsNode,
    dom.button {
      type = "button",
      class = "sb-in-add",
      onclick = function()
        local last = entries[#entries]
        if last and last.value == "" and last.ta and last.ta.value == "" then
          return render(last)
        end
        local new = { value = "" }
        table.insert(entries, new)
        render(new)
      end,
      dom.text("+ add item"),
    },
  }
end

--- A list shown as chips, with a text field that completes; `onChange` receives the new list, or nil when empty. The first completion is preselected: Enter or Tab accepts it, Shift-Enter commits the typed text as is, and with `allowNew` a space or comma commits the typed text too.
--- @param opts table { value?: table, onChange: function(list), readOnly?: boolean, placeholder?: string, complete?: function(prefix) returning { value, label?, description? }, allowNew?: boolean (default true), sigil?: string, display?: function(value), identify?: function(value), clean?: function(text), onOpen?: function(value), chipClass?: string, max?: number }
--- @return table an inline widget
--- @see API/widgets
function widgets.chipsInput(opts)
  local key = opts.identify or function(v) return v end
  local display = opts.display or function(v) return tostring(v) end
  local clean = opts.clean or function(text)
    local trimmed = text:match("^%s*(.-)%s*$")
    return trimmed ~= "" and trimmed or nil
  end
  local allowNew = opts.allowNew ~= false
  local readOnly = opts.readOnly
  local sigil = opts.sigil or ""
  -- Shared by every handler of this widget (see widgets.listInput)
  local items = copy(opts.value)
  local chipsNode = dom.span { class = "sb-in-chip-list" }
  local input, list
  local generation = 0
  local warmed = false

  local function taken()
    local set = {}
    for _, v in ipairs(items) do set[key(v)] = true end
    return set
  end

  local function changed()
    opts.onChange(#items > 0 and copy(items) or nil)
  end

  local render

  local function remove(value)
    for i, v in ipairs(items) do
      if v == value then
        table.remove(items, i)
        render()
        changed()
        return
      end
    end
  end

  local function chip(value)
    return dom.span {
      class = { "sb-in-chip", opts.chipClass or "sb-in-chip-link" },
      dom.a {
        class = "sb-in-chip-label",
        href = "#",
        onclick = function(e)
          e.preventDefault()
          if opts.onOpen then opts.onOpen(value) end
        end,
        dom.text(sigil .. tostring(display(value))),
      },
      not readOnly and dom.button {
        type = "button",
        class = "sb-in-x",
        tabindex = "-1",
        title = "Remove",
        onmousedown = preventDefault,
        onclick = function(e)
          e.preventDefault()
          remove(value)
          if input then input.focus() end
        end,
        dom.text("×"),
      },
    }
  end

  render = function()
    local nodes = {}
    for i, v in ipairs(items) do nodes[i] = chip(v) end
    chipsNode.replaceChildren(table.unpack(nodes))
    -- A full widget still takes input: a pick replaces the last chip in place
    if input then
      local full = opts.max ~= nil and #items >= opts.max
      input.placeholder = full and "" or (opts.placeholder or "")
    end
  end

  local function add(value)
    if value == nil or value == "" or taken()[key(value)] then return end
    while opts.max and #items >= opts.max do table.remove(items) end
    table.insert(items, value)
    render()
    changed()
  end

  local function accept(option)
    input.value = ""
    list.hide()
    add(option.value)
    input.focus()
  end

  local function commitTyped()
    local text = input.value
    input.value = ""
    list.hide()
    if not allowNew then return end
    add(clean(text))
  end

  local function suggest(showAll, index)
    local typed = input.value:match("^%s*(.-)%s*$")
    if sigil ~= "" and typed:sub(1, #sigil) == sigil then typed = typed:sub(#sigil + 1) end
    if typed == "" and not showAll then return list.hide() end
    generation = generation + 1
    local mine = generation
    local options = opts.complete and opts.complete(typed) or {}
    -- A newer keystroke may have asked again while this one waited
    if mine ~= generation then return end
    -- The first match is selected, as in the page picker; Shift-Enter
    -- commits the typed text instead
    list.show(filterOptions(options, typed, taken(), key), index or 1)
  end

  render()
  if readOnly then
    return dom.span { class = "sb-in-chips", chipsNode }
  end

  list = dropdown(accept, sigil)
  input = dom.input {
    type = "text",
    class = "sb-in-chip-input",
    -- Typed text isn't in the page until it becomes a chip
    ["data-sb-committed"] = "",
    autocomplete = "off",
    autocapitalize = "off",
    autocorrect = "off",
    spellcheck = "false",
    placeholder = opts.placeholder,
    onfocus = function()
      if not warmed and opts.complete then
        warmed = true
        opts.complete("")
      end
    end,
    oninput = function()
      -- Pasted text, and mobile keyboards that don't report keys, arrive here
      local text = input.value
      if allowNew and text:find("[,%s]") then
        local rest = text:match("[^,%s]*$")
        input.value = rest
        for part in text:sub(1, #text - #rest):gmatch("[^,%s]+") do add(clean(part)) end
      end
      suggest()
    end,
    onblur = function()
      list.hide()
      if allowNew and input.value:match("%S") then commitTyped() end
    end,
    onkeydown = function(e)
      local k = e.key
      -- Safari ends a composition with an Enter whose isComposing is false
      if e.isComposing or e.keyCode == 229 then return end
      if k == "ArrowDown" then
        e.preventDefault()
        if list.open then list.move(1) else suggest(true, 1) end
      elseif k == "ArrowUp" then
        if list.open then
          e.preventDefault()
          list.move(-1)
        end
      elseif k == "Escape" then
        if list.open then
          e.preventDefault()
          list.hide()
        end
      elseif k == "Enter" and e.shiftKey then
        if input.value:match("%S") then
          e.preventDefault()
          list.hide()
          commitTyped()
        end
      elseif k == "Enter" or k == "Tab" then
        local picked = list.selected()
        if picked then
          e.preventDefault()
          accept(picked)
        elseif input.value:match("%S") then
          if k == "Enter" then e.preventDefault() end
          commitTyped()
        end
      elseif (k == " " or k == ",") and allowNew then
        e.preventDefault()
        commitTyped()
      elseif k == "Backspace" and input.value == "" and #items > 0 then
        e.preventDefault()
        remove(items[#items])
      end
    end,
  }
  render()
  return dom.span {
    class = "sb-in-chips",
    chipsNode,
    input,
    list.node,
  }
end

-- Caches what `fetch` returns for the life of one widget
local function cached(fetch)
  local options
  return function()
    if options == nil then options = fetch() end
    return options
  end
end

local function stripPrefix(prefix)
  return function(text)
    local name = text:match("^%s*(.-)[%s,]*$")
    while name:sub(1, 1) == prefix do name = name:sub(2) end
    return name ~= "" and name or nil
  end
end

local function merged(opts, extra)
  local out = {}
  for k, v in pairs(opts) do out[k] = v end
  for k, v in pairs(extra) do if out[k] == nil then out[k] = v end end
  return out
end

--- Chips for tag names (without `#`), completing from the tags in the space; clicking one opens its tag page.
--- @param opts table { value?: string[], onChange: function(list), readOnly?: boolean, placeholder?: string } plus any chipsInput option
--- @return table an inline widget
--- @see API/widgets
function widgets.tagsInput(opts)
  local all = cached(function()
    local options = {}
    for _, name in ipairs(tagNames()) do
      table.insert(options, { value = name })
    end
    return options
  end)
  return widgets.chipsInput(merged(opts, {
    sigil = "#",
    chipClass = "sb-hashtag",
    display = function(v) return (tostring(v):gsub("^#", "")) end,
    identify = function(v) return (tostring(v):gsub("^#", "")) end,
    clean = stripPrefix("#"),
    complete = function() return all() end,
    onOpen = function(v)
      local name = tostring(v):gsub("^#", "")
      editor.navigate(config.get({ "tags", name, "tagPage" }) or ("tag:" .. name))
    end,
  }))
end

local function personName(v)
  return linkTarget(v) or (tostring(v):gsub("^@", ""))
end

--- Chips for `@names` (without `@`), completing from known identities; clicking one opens the Mention Inbox for it.
--- @param opts table { value?: string[], onChange: function(list), readOnly?: boolean, placeholder?: string } plus any chipsInput option
--- @return table an inline widget
--- @see API/widgets
function widgets.identitiesInput(opts)
  local all = cached(function()
    local options = {}
    for _, r in ipairs(system.invokeFunction("index.listIdentities")) do
      table.insert(options, { value = r.name, description = r.detail })
    end
    return options
  end)
  return widgets.chipsInput(merged(opts, {
    sigil = "@",
    chipClass = "sb-at-mention",
    display = personName,
    identify = function(v) return personName(v):lower() end,
    clean = stripPrefix("@"),
    complete = function() return all() end,
    onOpen = function(v)
      local target = linkTarget(v)
      if target then return editor.navigate(target) end
      editor.openNavigator("inbox", {
        dropdown = "@" .. personName(v):lower(),
        focus = false,
      })
    end,
  }))
end

local function refChips(opts, value, onChange, max)
  local all = cached(function()
    local options = {}
    for _, o in ipairs(refCandidates(opts.tag)) do
      table.insert(options, { value = o.link, label = o.name, description = o.description })
    end
    return options
  end)
  local o = merged(opts, {
    allowNew = false,
    display = function(v) return linkTarget(v) or tostring(v) end,
    complete = function() return all() end,
    onOpen = function(v)
      local target = linkTarget(v)
      if target then editor.navigate(target) end
    end,
  })
  o.value, o.onChange, o.max = value, onChange, max
  return widgets.chipsInput(o)
end

--- A single reference (`"[[Page]]"` or `"[[$anchor]]"`) as a chip completing from pages and anchored objects.
--- @param opts table { value?: string, onChange: function(link), readOnly?: boolean, tag?: string (only objects with this tag) }
--- @return table an inline widget
--- @see API/widgets
function widgets.refInput(opts)
  return refChips(opts, opts.value ~= nil and { opts.value } or {}, function(list)
    opts.onChange(list and list[1] or nil)
  end, 1)
end

--- A list of references (`"[[Page]]"`, `"[[$anchor]]"`) as chips completing from pages and anchored objects.
--- @param opts table { value?: string[], onChange: function(list), readOnly?: boolean, tag?: string (only objects with this tag) }
--- @return table an inline widget
--- @see API/widgets
function widgets.refListInput(opts)
  return refChips(opts, opts.value, opts.onChange)
end
```
