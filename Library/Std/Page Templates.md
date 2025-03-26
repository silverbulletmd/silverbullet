# Quick Note
```space-lua
command.define {
  name = "Quick Note",
  key = "Alt-Shift-n",
  run = function()
    local pageName = "Inbox/" .. os.date("%Y-%m-%d/%H-%M-%S")
    editor.navigate(pageName)
  end
}
```
