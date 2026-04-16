---
description: APIs to define custom action buttons
tags: meta/api
---

APIs to more conveniently define action buttons (alternative to setting them via regular [[^Library/Std/Config]]).

# API
## actionButton.define(spec)
Keys to define:

* `icon`: [feather icon](https://feathericons.com) to use for your button
* `command` (optional): command name to invoke when clicked. When set, the command's keyboard shortcut is automatically shown in the tooltip. Replaces `run`.
* `run` (optional): function to invoke once the button is pushed. Use this for custom logic that doesn't map to a single command.
* `description` (optional): description of button (appears on hover)
* `priority` (optional): determines priority of button (the higher, the earlier in the list)
* `mobile`: when set to `true` this button will only appear on mobile devices
* `standalone`: when set to `true` this button will only appear in standalone/PWA mode; when `false`, only in browser mode
* `dropdown` (optional): when set to `false`, the button stays visible outside the dropdown menu on mobile (default: `true`)

Either `command` or `run` should be specified.

# Examples
```lua
-- Bind a button to a command (keyboard shortcut shown on hover)
actionButton.define {
  icon = "pen-tool",
  description = "Start journaling",
  command = "Journal: Today",
}

-- Custom button with a run function
actionButton.define {
  icon = "eye",
  run = function()
    editor.setUiOption("forcedROMode", true)
    editor.rebuildEditorState()
  end
}
```
# Implementation
```space-lua
-- priority: 100

actionButton = actionButton or {}

function actionButton.define(spec)
  local actionButtonConfig = config.get("actionButtons", {})
  table.insert(actionButtonConfig, spec)
end
```
