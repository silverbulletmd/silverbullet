---
description: APIs to define share targets for e.g. Android
tags: meta/api
---
On some platforms (notably Android), SilverBullet can receive links, text, and files through a supported operating system share sheet. Each installed space appears once in the share sheet. SilverBullet then shows an editable draft and discovers actions with the `capture` service selector. Changes to Space Lua actions appear when Space Lua reloads.

The `match` function receives `id`, `receivedAt`, `title`, `text`, `url`, and `files`. Each file has a `handle`, `name`, `type`, and `size`; file bytes are omitted during discovery. Return `nil` to hide an action for this draft or a table with `name`, `description`, and optional `priority` to offer it.

```lua
service.define {
  selector = "capture",
  match = function(data)
    if data.text == "" then return nil end
    return { name = "Save shared text", description = "Create a page from the shared text" }
  end,
  run = function(data)
    space.writePage("Inbox/Shared " .. data.id, data.text)
  end,
}
```

An action's `run` function receives the edited draft. Within `run`, `capture.readFile(handle)` returns the file bytes and `capture.saveFile(handle, path)` writes a document after checking the path and size. Handles work only while that capture action is running. `saveFile` returns `true` when it creates a file, returns `false` when identical bytes already exist, and rejects a conflicting file. A failed action leaves the draft pending so it can be retried; a successful action removes the pending draft.

The bundled **Save as Quick Note** action is itself a Space Lua capture service. It creates an `Inbox/` page and links saved files. Set `capture.quickNote` to `false` in `CONFIG.md` to hide it:

```lua
config.set("capture.quickNote", false)
```

```space-lua
config.defineCategory {
  name = "Capture",
  description = "Choose the built-in actions available for incoming shares.",
  priority = 25,
}

config.define("capture", {
  description = "Configure incoming shares",
  type = "object",
  properties = {
    quickNote = {
      type = "boolean",
      default = true,
      description = "Offer Save as Quick Note when a share arrives",
      ui = { category = "Capture", label = "Save as Quick Note", priority = 1 },
    },
  },
})

local function trim(value)
  local withoutStart = value:gsub("^%s+", "")
  return (withoutStart:gsub("%s+$", ""))
end

local function destinationName(name)
  local sanitized = name:gsub("[^%w%._%-]", "_")
  local safe = sanitized:gsub("^%.+", "")
  if safe == "" then return "file.bin" end
  return safe
end

local function pageURI(path)
  return path:gsub("[^%w%._~%/-]", function(char)
    return string.format("%%%02X", string.byte(char))
  end)
end

service.define {
  selector = "capture",
  match = function(data)
    if not config.get("capture.quickNote", true) then return nil end
    local limit = config.get("maximumDocumentSize", 10) * 1024 * 1024
    for _, file in ipairs(data.files) do
      if file.size > limit then return nil end
    end
    return {
      name = "Save as Quick Note",
      description = "Create an Inbox page",
      priority = 100,
    }
  end,
  run = function(data)
    local receivedAt = math.floor(data.receivedAt / 1000)
    local datePath = os.date("!%Y-%m-%d", receivedAt)
    local clock = os.date("!%H-%M-%S", receivedAt)
    local page = "Inbox/" .. datePath .. "/" .. clock .. "-" .. data.id
    local destinations = {}
    local lines = {}
    local title = trim(data.title)
    if title ~= "" then
      table.insert(lines, "# " .. title:gsub("[\r\n]+", " "))
    end
    local body = trim(data.text)
    if body ~= "" then table.insert(lines, body) end
    local url = trim(data.url)
    if url ~= "" then table.insert(lines, url) end
    for index, file in ipairs(data.files) do
      local path = "Inbox/" .. datePath .. "/attachments/" .. data.id .. "/" .. index .. "-" .. destinationName(file.name)
      table.insert(destinations, { handle = file.handle, path = path })
      local label = file.name:gsub("\\", "\\\\")
      label = label:gsub("%[", "\\[")
      label = label:gsub("%]", "\\]")
      table.insert(lines, "[" .. label .. "](" .. pageURI(path) .. ")")
    end
    local content = table.concat(lines, "\n\n") .. "\n"
    local created = {}
    local ok, failure = pcall(function()
      for _, destination in ipairs(destinations) do
        if capture.saveFile(destination.handle, destination.path) then
          table.insert(created, destination.path)
        end
      end
      if space.pageExists(page) then
        if space.readPage(page) ~= content then
          error("Quick Note conflict: " .. page)
        end
      else
        space.writePage(page, content)
      end
      if space.readPage(page) ~= content then
        error("Quick Note verification failed: " .. page)
      end
    end)
    if not ok then
      if not space.pageExists(page) then
        for _, path in ipairs(created) do
          space.deleteDocument(path)
        end
      end
      error(failure)
    end
    editor.navigate(page)
  end,
}
```
