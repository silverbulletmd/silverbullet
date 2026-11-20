Adds a `Page: Set Icon` command that picks an [icon](https://silverbullet.md/Reference/Theming/Icons) for the current page and stores it as `pageDecoration.icon` in its frontmatter.

```space-lua
-- priority: 10
local function setPageIcon()
  local text = editor.getText()
  local fm = index.extractFrontmatter(text).frontmatter or {}
  local decoration = {}
  if type(fm.pageDecoration) == "table" then
    for k, v in pairs(fm.pageDecoration) do
      decoration[k] = v
    end
  end
  local picked = editor.pickIcon {
    title = "Page icon",
    initial = decoration.icon,
  }
  if picked == nil then
    return
  end
  if picked == "" then
    decoration.icon = nil
  else
    decoration.icon = picked
  end
  local patch
  if next(decoration) == nil then
    patch = {op = "delete-key", path = "pageDecoration"}
  else
    patch = {op = "set-key", path = "pageDecoration", value = decoration}
  end
  editor.setText(index.patchFrontmatter(text, {patch}))
end

if system.getMode() == "rw" then
  command.define {
    name = "Page: Set Icon",
    icon = "face-slightly-smiling",
    requireEditor = "page",
    run = setPageIcon,
  }
end
```
