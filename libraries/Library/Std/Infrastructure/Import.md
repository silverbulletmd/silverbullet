---
description: Implements the infrastructure of the Import commands.
tags: meta
---
Provides infrastructure for importing pages outside of your space. It standardizes the ${widgets.commandButton("Import: URL")} to export the current page or selection in various ways.

# Technical architecture
Steps:
1. The user is asked to supply a URL
2. An `import:discover` event is triggered with:
   * `url` the URL the user supplied
3. Listeners can respond with:
   * `id`: Call identifier
   * `name`: Presented name for the importer
4. Ask user to select option, then invoke `import:run:${id}` with the same data as step 2
5. Importer listens to this event and handles it as it sees fit.

General best practices for importers:
* Set the `source` key in the imported frontmatter to the type importer used (to allow for later automated updating of content)
* Set another key in frontmatter that points to the origin URL somehow (also for later updating use)

# Implementation
```space-lua
command.define {
  name = "Import: URL",
  key = "Ctrl-Shift-i",
  mac = "Cmd-Shift-i",
  run = function()
    local url = editor.prompt("URL to import:")
    if not url then
      return
    end
    local importObj = { url = url }
    local handlers = event.dispatch("import:discover", importObj)
    if #handlers == 0 then
      editor.flashNotification("No importers available for URL", "error")
      return
    end
    local selectionOptions = {}
    for _, handler in ipairs(handlers) do
      for _, option in ipairs(handler) do
        table.insert(selectionOptions, option)
      end
    end
    local selectedOption = editor.filterBox("Select importer",
      selectionOptions, "Pick your desired importer from the list")
    if not selectedOption then
      return
    end
    event.dispatch("import:run:" .. selectedOption.id, importObj)
  end
}
```

# Implementation for .md URLs
```space-lua
event.listen {
  name = "import:discover",
  run = function(event)
    local url = event.data.url
    if url:endsWith(".md") then
      return {
        {
          id = "markdown-import",
          name = "Markdown"
        },
      }
    end
  end
}

event.listen {
  name = "import:run:markdown-import",
  run = function(e)
    local url = e.data.url
    local req = http.request(url)
    if not req.ok then
      editor.flashNotification("Failed to import, see console for error")
      js.log("Error", req)
      return
    end
    local content = req.body
    local fm = index.extractFrontmatter(content)
    -- Extract the last part of the path, without the .md
    local suggestedPath = url:match("^.*/([^/?#]+)%.md$")
    if table.includes(fm.frontmatter.tags, "meta") then
      -- Maybe more of a library function
      suggestedPath = "Library/" .. suggestedPath
    end
    local localPath = editor.prompt("Save to", suggestedPath)
    if not localPath then
      return
    end
    if space.fileExists(localPath .. ".md") then
      editor.flashNotification("Page already exists, won't do that", "error")
      return
    end
    space.writePage(localPath, content)
    editor.flashNotification("Imported to " .. localPath)
    editor.navigate({kind="page", page=localPath})
    local updated = index.patchFrontmatter(editor.getText(),
    {
      {op="set-key", path="source", value="markdown-import"},
      {op="set-key", path="sourceUrl", value=url},
    })
    editor.setText(updated)
  end
}
```
