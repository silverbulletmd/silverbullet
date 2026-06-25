#meta

This page implements functionality for overriding default title rendered on the top bar of a page.

```space-lua
service.define {
  selector = "customizePageTitle",
  match = {
     -- Other plugs of higher priority may override this behavior.
     -- Std has an opt-in editor config to only show the base name of the path.
    priority=1
  },

  -- path here is without the extension.
  -- (path: string): string
  run = function(path)
    local opt = config.get("StripPagePathInTitle", false);
    if not opt then
        return path
    end

    if path == "" then
        return ""
    end

    local parts = string.split(path, "/");
    local base = parts[# parts]

    return base;
  end
}
```
