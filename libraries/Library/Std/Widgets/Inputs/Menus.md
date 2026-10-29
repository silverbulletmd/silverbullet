---
description: Input dropdowns and context menu interaction.
tags: meta
---
Input dropdowns and context menu interaction. Internal implementation of [[Library/Std/Widgets/Inputs]].

```space-lua
-- priority: 45
widgets = widgets or {}
local function preventDefault(e) e.preventDefault() end
-- A list of options under an element: show/hide, keyboard selection, pick
local function dropdown(onPick, sigil)
  local self = { items = {}, index = 0, open = false }
  local node = dom.div { class = "sb-in-dropdown", role = "listbox" }
  node.hidden = true
  self.node = node

  local function mark()
    local children = node.children
    for i = 0, children.length - 1 do
      children.item(i).classList.toggle("sb-in-selected", i + 1 == self.index)
    end
  end

  function self.show(items, index)
    if #items == 0 then return self.hide() end
    self.items, self.index = items, index or 0
    local rows = {}
    for i, item in ipairs(items) do
      rows[i] = dom.button {
        type = "button",
        tabindex = "-1",
        class = "sb-in-option",
        role = "option",
        -- Keeps focus in the input that opened the list
        onmousedown = preventDefault,
        onclick = function(e)
          e.preventDefault()
          onPick(item)
        end,
        dom.span {
          class = "sb-in-option-label",
          dom.text((sigil or "") .. tostring(item.label or item.value)),
        },
        item.description and dom.span {
          class = "sb-in-option-description",
          dom.text(tostring(item.description)),
        },
      }
    end
    node.replaceChildren(table.unpack(rows))
    node.hidden = false
    self.open = true
    mark()
  end

  function self.hide()
    self.open, self.items, self.index = false, {}, 0
    node.hidden = true
  end

  function self.move(delta)
    local n = #self.items
    if n == 0 then return end
    if self.index == 0 then
      self.index = delta > 0 and 1 or n
    else
      self.index = ((self.index - 1 + delta) % n) + 1
    end
    mark()
  end

  function self.selected()
    return self.open and self.items[self.index] or nil
  end

  return self
end

-- Closes `menu` on a mousedown outside `within`, until `stop()` is called
local function onOutsideClick(within, close)
  local controller = js.new(js.window.AbortController)
  js.window.document.addEventListener("mousedown", function(e)
    if not within.contains(e.target) then close() end
  end, { capture = true, signal = controller.signal })
  return function() controller.abort() end
end

-- The next selectable index in a menu of `count` items, wrapping; 0 means
-- nothing selected yet
local function cycleIndex(index, count, delta)
  if count == 0 then return 0 end
  if index == 0 then return delta > 0 and 1 or count end
  return ((index - 1 + delta) % count) + 1
end

--- A quiet ⋯ button that opens a small menu, shown when its `sb-in-menu-owner` ancestor is hovered or focused.
--- @param opts table { items: table | function() (a list of { label, onSelect, disabled?, reason?, danger? }, { header }, { separator = true }), title?: string, keepFocus?: boolean }
--- @return table an inline widget
--- @see API/widgets
function widgets.menu(opts)
  local root, button, list
  local entries, index = {}, 0
  local stops = {}

  local function mark()
    for i, e in ipairs(entries) do
      e.node.classList.toggle("sb-in-selected", i == index)
    end
    -- Keyboard use: focus follows the selection, so it's announced; with
    -- keepFocus, the field being edited keeps focus
    local selected = entries[index]
    if selected and root.contains(js.window.document.activeElement) then
      selected.node.focus()
    end
  end

  local function close(refocus)
    if not list then return end
    for _, stop in ipairs(stops) do stop() end
    stops = {}
    list.remove()
    list, entries, index = nil, {}, 0
    root.classList.remove("sb-in-menu-open")
    button.setAttribute("aria-expanded", "false")
    if refocus then button.focus() end
  end

  local function choose(item)
    local hadFocus = root.contains(js.window.document.activeElement)
    close(hadFocus)
    if item.disabled then
      if item.reason then editor.flashNotification(item.reason, "error") end
      return
    end
    item.onSelect()
  end

  local function open(preselect)
    local items = opts.items
    if type(items) == "function" then items = items() end
    local nodes = {}
    entries = {}
    for _, item in ipairs(items or {}) do
      if item.header then
        table.insert(nodes, dom.div {
          class = "sb-in-menu-header",
          role = "presentation",
          dom.text(tostring(item.header)),
        })
      elseif item.separator then
        table.insert(nodes, dom.div { class = "sb-in-menu-separator", role = "separator" })
      else
        local node = dom.button {
          type = "button",
          tabindex = "-1",
          role = "menuitem",
          class = {
            "sb-in-option",
            item.disabled and "sb-in-disabled",
            item.danger and "sb-in-danger",
          },
          title = item.disabled and item.reason or nil,
          ["aria-disabled"] = item.disabled and "true" or nil,
          onmousedown = preventDefault,
          onclick = function(e)
            e.preventDefault()
            choose(item)
          end,
          dom.span { class = "sb-in-option-label", dom.text(tostring(item.label)) },
        }
        table.insert(entries, { item = item, node = node })
        table.insert(nodes, node)
      end
    end
    list = dom.div { class = "sb-in-dropdown sb-in-menu", role = "menu", nodes }
    root.appendChild(list)
    root.classList.add("sb-in-menu-open")
    button.setAttribute("aria-expanded", "true")
    index = preselect and cycleIndex(0, #entries, 1) or 0
    mark()
    -- While open, the menu owns these keys, wherever focus is
    local controller = js.new(js.window.AbortController)
    js.window.document.addEventListener("keydown", function(e)
      -- A re-render may have dropped this menu without closing it
      if not root.isConnected then return close(false) end
      local key = e.key
      if key == "Escape" then
        e.preventDefault()
        e.stopPropagation()
        close(root.contains(js.window.document.activeElement))
      elseif key == "ArrowDown" or key == "ArrowUp" then
        e.preventDefault()
        e.stopPropagation()
        index = cycleIndex(index, #entries, key == "ArrowDown" and 1 or -1)
        mark()
      elseif key == "Enter" or (key == " " and index > 0) then
        if index == 0 then return close(false) end
        e.preventDefault()
        e.stopPropagation()
        choose(entries[index].item)
      elseif key == "Tab" then
        close(false)
      end
    end, { capture = true, signal = controller.signal })
    table.insert(stops, function() controller.abort() end)
    table.insert(stops, onOutsideClick(root, function() close(false) end))
  end

  button = dom.button {
    type = "button",
    tabindex = "-1",
    class = "sb-in-more",
    title = opts.title or "Actions",
    ["aria-label"] = opts.title or "Actions",
    ["aria-haspopup"] = "menu",
    ["aria-expanded"] = "false",
    -- With keepFocus, a click leaves focus where it was (a text being edited)
    onmousedown = opts.keepFocus and preventDefault or nil,
    onclick = function(e)
      e.preventDefault()
      if list then return close(false) end
      -- detail is 0 for a click from the keyboard (Enter or Space)
      open(e.detail == 0)
    end,
    dom.text("⋯"),
  }
  root = dom.span { class = "sb-in-menu-root", button }
  return root
end

-- Opens the menu of an `widgets.menu` node as from the keyboard: focus moves
-- into it, on its first item
--- Opens a `widgets.menu` node as from the keyboard, focus on its first item.
--- @param menuNode table the node returned by widgets.menu
--- @see API/widgets
function widgets.openMenu(menuNode)
  local button = menuNode and menuNode.querySelector(".sb-in-more")
  if not button or menuNode.classList.contains("sb-in-menu-open") then return end
  button.focus()
  button.click()
end


widgets.inputMenus = {
  dropdown = dropdown,
  cycleIndex = cycleIndex,
}
```
