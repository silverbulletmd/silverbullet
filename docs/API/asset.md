---
tags: api/syscall
references:
- plug-api/syscalls/asset.ts
- client/plugos/syscalls/asset.ts
- client/asset_bundle/bundle.ts
---

The Asset API provides functions for reading and managing assets embedded in plugs.

<!--#lua spacelua.renderApiDocumentation("asset") -->
## asset.getFileMeta

`asset.getFileMeta(plugName, name)`

Gets metadata for an asset embedded in a plug.

**Parameters:**

- `plugName` (`string`) — Plug name.
- `name` (`string`) — Asset path.

**Returns:**

- `table` — File metadata.

**Example:**

```lua
local meta = asset.getFileMeta("myplug", "data.txt")
print(meta.lastModified)
```

## asset.listFiles

`asset.listFiles(plugName)`

Lists the assets embedded in a plug.

**Parameters:**

- `plugName` (`string`) — Plug name.

**Returns:**

- `table` — List of file metadata.

**Example:**

```lua
for _, file in ipairs(asset.listFiles("myplug")) do
  print(file.name)
end
```

## asset.readAsset

`asset.readAsset(plugName, name)`

Reads an asset embedded in a plug as a data URL.

**Parameters:**

- `plugName` (`string`) — Plug name.
- `name` (`string`) — Asset path.

**Returns:**

- `string` — Asset data URL.

**Example:**

```lua
local image = asset.readAsset("myplug", "image.png")
```
<!--/lua-->

