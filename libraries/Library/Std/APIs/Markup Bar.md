---
description: APIs to add buttons to the markup bar
tags: meta/api
---

Defines the buttons of the markup bar: the phone bar above the keyboard (`mobile`), the desktop bubble over selected text (`selection`) and the desktop ⋮ line menu (`line`), each with its own list in [[^Library/Std/Config]].

See [[API/markupBar]] for the keys, contexts and examples.

# Implementation
```space-lua
-- priority: 100

markupBar = markupBar or {}

local markupSurfaces = { mobile = true, selection = true, line = true }

--- Appends a button to one markup bar surface: the phone bar above the keyboard, the desktop selection bubble or the desktop line menu.
--- @param spec table { surface: "mobile"|"selection"|"line", icon: string, command?: string, run?: function, description?: string, onlyContexts?: string[], exceptContexts?: string[], group?: string, activeContexts?: string[] }; set `command` or `run`. `group` and `activeContexts` are for the line menu only
--- @see API/markupBar
function markupBar.define(spec)
  local surface = spec.surface
  if not markupSurfaces[surface] then
    error("markupBar.define needs surface = \"mobile\", \"selection\" or \"line\"")
  end
  local button = {}
  for k, v in pairs(spec) do
    if k ~= "surface" then
      button[k] = v
    end
  end
  local key = "markupBar." .. surface
  -- A space that still sets the deprecated `keyboardBar` list gets that one
  -- on the phone bar
  if surface == "mobile" and config.get("keyboardBar") then
    key = "keyboardBar"
  end
  local buttons = config.get(key)
  if buttons then
    table.insert(buttons, button)
  else
    config.set(key, {button})
  end
end

keyboardBar = keyboardBar or {}

--- Deprecated: use markupBar.define with surface = "mobile".
--- @see API/markupBar
function keyboardBar.define(spec)
  local button = {}
  for k, v in pairs(spec) do
    button[k] = v
  end
  button.surface = "mobile"
  markupBar.define(button)
end
```
