#meta

APIs to more conveniently define action buttons (alternative to setting them via regular [[^Library/Std/Config]]).

# API
## actionButton.define(spec)
Keys to define:

* `icon`: [feather icon](https://feathericons.com) to use for your button
* `run`: function to invoke once the button is pushed
* `description` (optional): description of button (appears on hover)
* `priority` (optional): determines priority of button (the higher, the earlier in the list)
* `mobile`: when set to `true` this button will only appear on mobile devices

# Example
```lua
-- Defines a new button that forces your UI into read-only mode
actionButton.define {
  icon = "eye",
  -- Uncomment the following line to only make this button appear 
  -- ONLY on mobile devices:
  --   mobile = true,
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