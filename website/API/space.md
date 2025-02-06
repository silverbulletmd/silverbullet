The Space API provides functions for interacting with pages, attachments, and files in the space.

# Page Operations

## space.listPages()
Returns a list of all pages in the space.

Example:
```lua
local pages = space.listPages()
for page in each(pages) do
    print(page.name)
end
```

## space.readPage(name)
Reads the content of a page.

Example:
```lua
local content = space.readPage("welcome")
print(content)  -- prints the content of the "welcome" page
```

## space.getPageMeta(name)
Gets metadata for a specific page.

Example:
```lua
local meta = space.getPageMeta("welcome")
print(meta.name, meta.lastModified)  -- prints page name and last modified date
```

## space.writePage(name, text)
Writes content to a page.

Example:
```lua
local meta = space.writePage("notes", "My new note content")
print("Page updated at: " .. meta.lastModified)
```

## space.deletePage(name)
Deletes a page from the space.

Example:
```lua
space.deletePage("old-notes")
```

# Attachment Operations

## space.listAttachments()
Returns a list of all attachments in the space.

Example:
```lua
local attachments = space.listAttachments()
for att in each(attachments) do
    print(att.name, att.size)
end
```

## space.readAttachment(name)
Reads the content of an attachment.

Example:
```lua
local data = space.readAttachment("image.png")
print("Attachment size: " .. #data .. " bytes")
```

## space.writeAttachment(name, data)
Writes binary data to an attachment.

Example:
```lua
local binaryData = string.char(72, 69, 76, 76, 79)  -- "HELLO" in binary
local meta = space.writeAttachment("test.bin", binaryData)
print("Attachment saved with size: " .. meta.size)
```

## space.deleteAttachment(name)
Deletes an attachment from the space.

Example:
```lua
space.deleteAttachment("old-image.png")
```

# File Operations

## space.listFiles()
Returns a list of all files in the space.

Example:
```lua
local files = space.listFiles()
for _, file in ipairs(files) do
    print(file.name, file.size)
end
```

## space.getFileMeta(name)
Gets metadata for a specific file.

Example:
```lua
local meta = space.getFileMeta("document.txt")
print(meta.name, meta.modified, meta.size)
```

## space.readFile(name)
Reads the content of a file.

Example:
```lua
local content = space.readFile("document.txt")
print("File size: " .. #content .. " bytes")
```

## space.writeFile(name, data)
Writes binary data to a file.

Example:
```lua
local text = "Hello, World!"
local meta = space.writeFile("greeting.txt", text)
print("File written with size: " .. meta.size)
```

## space.deleteFile(name)
Deletes a file from the space.

Example:
```lua
space.deleteFile("old-document.txt")
```

## space.fileExists(name)
Checks if a file exists in the space.

Example:
```lua
if space.fileExists("config.json") then
    print("Config file exists!")
else
    print("Config file not found")
end
