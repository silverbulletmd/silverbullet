The Asset API provides functions for reading and managing assets embedded in plugs.

### asset.readAsset(plugName, name, encoding?)
Reads an asset embedded in a plug.

Parameters:
- `plugName`: Name of the plug to read asset from
- `name`: Name of the asset to read
- `encoding`: Optional encoding type, either "utf8" (default) or "dataurl"

Returns the content of the asset in the requested encoding.

Example:
```lua
-- Read a text file as UTF-8
local text = asset.readAsset("myplug", "data.txt")
print(text)

-- Read an image as data URL
local imageData = asset.readAsset("myplug", "image.png", "dataurl")
print(imageData)
```

### asset.listFiles(plugName)
Lists all files in a plug.

Parameters:
- `plugName`: Name of the plug to list files from

Returns an array of FileMeta objects containing information about each file.

Example:
```lua
local files = asset.listFiles("myplug")
for _, file in ipairs(files) do
    print(file.name, file.size)
end
```

### asset.getFileMeta(plugName, name)
Gets metadata about a specific file in a plug.

Parameters:
- `plugName`: Name of the plug
- `name`: Name of the file to get metadata for

Returns a FileMeta object containing information about the file.

Example:
```lua
local meta = asset.getFileMeta("myplug", "data.txt")
print("File size:", meta.size)
print("Last modified:", meta.lastModified)
``` 