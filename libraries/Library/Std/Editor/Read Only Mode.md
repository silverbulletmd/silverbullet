#meta

Adds commands and an action button (on mobile) for toggling read-only mode.

```space-lua
function toggleReadOnlyMode()
  local ro = editor.getUiOption("forcedROMode")
  ro = not ro
  editor.setUiOption("forcedROMode", ro)
  editor.rebuildEditorState()
  if ro then
    editor.flashNotification("Read-only mode enabled")
  else
    editor.flashNotification("Read-only mode disabled")
  end
end

print("System mode", system.getMode())

if system.getMode() == "rw" then
  command.define {
    name = "Editor: Toggle Read Only Mode",
    run = toggleReadOnlyMode
  }

  actionButton.define {
    icon = "lock",
    description = "Toggle read-only mode",
    mobile = true,
    run = toggleReadOnlyMode
  }
end
```
