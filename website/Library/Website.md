#meta

Some silverbullet.md specific widgets etc.

```space-lua
event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    local meta = editor.getCurrentPageMeta()
    if not meta then
      return
    end
    local maturityTag = nil
    for _, tagName in ipairs(meta.tags) do
      if tagName:startsWith("maturity/") then
        maturityTag = tagName
      end
    end
    if maturityTag then
      return widget.new {
        markdown = spacelua.interpolate([==[
**Note:** This is a #${maturityTag} feature. Feel free to use it, but it may change (significantly) in the future or potentially be replaced.
]==], {maturityTag=maturityTag}),
        cssClasses = {"website-warning"},
        display = "block"
      }
    end
  end
}
```

```space-style
.website-warning {
  background-color: #fff1d8;
  padding: 10px;
  margin: 0px !important;
}
```

