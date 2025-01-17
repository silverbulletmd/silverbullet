The Space API provides functions for interacting with pages, attachments, and files in the space.

# Page Operations

## space.list_pages()
Returns a list of all pages in the space.

Example:
```lua
local pages = space.list_pages()
for page in each(pages) do
    print(page.name)
end
```

## space.read_page(name)
Reads the content of a page.

Example:
```lua
local content = space.read_page("welcome")
print(content)  -- prints the content of the "welcome" page
```

## space.get_page_meta(name)
Gets metadata for a specific page.

Example:
```lua
local meta = space.get_page_meta("welcome")
print(meta.name, meta.lastModified)  -- prints page name and last modified date
```

## space.write_page(name, text)
Writes content to a page.

Example:
```lua
local meta = space.write_page("notes", "My new note content")
print("Page updated at: " .. meta.lastModified)
```

## space.delete_page(name)
Deletes a page from the space.

Example:
```lua
space.delete_page("old-notes")
```

# Attachment Operations

## space.list_attachments()
Returns a list of all attachments in the space.

Example:
```lua
local attachments = space.list_attachments()
for att in each(attachments) do
    print(att.name, att.size)
end
```

## space.read_attachment(name)
Reads the content of an attachment.

Example:
```lua
local data = space.read_attachment("image.png")
print("Attachment size: " .. #data .. " bytes")
```

## space.write_attachment(name, data)
Writes binary data to an attachment.

Example:
```lua
local binary_data = string.char(72, 69, 76, 76, 79)  -- "HELLO" in binary
local meta = space.write_attachment("test.bin", binary_data)
print("Attachment saved with size: " .. meta.size)
```

## space.delete_attachment(name)
Deletes an attachment from the space.

Example:
```lua
space.delete_attachment("old-image.png")
```

# File Operations

## space.list_files()
Returns a list of all files in the space.

Example:
```lua
local files = space.list_files()
for _, file in ipairs(files) do
    print(file.name, file.size)
end
```

## space.get_file_meta(name)
Gets metadata for a specific file.

Example:
```lua
local meta = space.get_file_meta("document.txt")
print(meta.name, meta.modified, meta.size)
```

## space.read_file(name)
Reads the content of a file.

Example:
```lua
local content = space.read_file("document.txt")
print("File size: " .. #content .. " bytes")
```

## space.write_file(name, data)
Writes binary data to a file.

Example:
```lua
local text = "Hello, World!"
local meta = space.write_file("greeting.txt", text)
print("File written with size: " .. meta.size)
```

## space.delete_file(name)
Deletes a file from the space.

Example:
```lua
space.delete_file("old-document.txt")
```

## space.file_exists(name)
Checks if a file exists in the space.

Example:
```lua
if space.file_exists("config.json") then
    print("Config file exists!")
else
    print("Config file not found")
end
```
