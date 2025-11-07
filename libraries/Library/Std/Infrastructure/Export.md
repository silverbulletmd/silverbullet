---
description: Implements the infrastructure of the Export commands.
tags: meta
---
Provides infrastructure for exporting pages outside of your space. It standardizes the ${widgets.commandButton("Export: Page Or Selection")} to export the current page or selection in various ways.

# Architecture
Flow:

1. Service discovery with `export` selector with data:
  * `pageMeta`
  * `text` (either the selection text or the entire page text)
2. Respond with:
  * `name`
  * `description`
  * `priority`
3. Ask user to select option, then invokes the selected service.

# Implementation
```space-lua
command.define {
  name = "Export: Page Or Selection",
  key = "Ctrl-e",
  mac = "Cmd-e",
  run = function()
    editor.save()
    local text = editor.getText()
    local meta = editor.getCurrentPageMeta()
    local selection = editor.getSelection()
    local exportObj = {
      pageMeta = meta,
      text = selection.text != "" and selection.text or text
    }
    local services = service.discover("export", exportObj)
    if #services == 0 then
      editor.flashNotification("No exporters available", "error")
      return
    end
    local selectedOption = editor.filterBox("Export to",
      services, "Select your export mechanism")
    if not selectedOption then
      return
    end
    service.invoke(selectedOption, exportObj)
  end
}
```

# Clipboard exporters
Implements two exporters:
* Copy rich text (e.g. for pasting into a Google Docs)
* Copy clean markdown

```space-lua
service.define {
  selector = "export",
  match = {
    name = "Clipboard: Export Rich Text",
    description = "To paste into Google Docs or other WYSIWYG environment"
  },
  run = function(data)
    local mdTree = markdown.parseMarkdown(data.text)
    mdTree = markdown.expandMarkdown(mdTree)
    local html = markdown.markdownToHtml(markdown.renderParseTree(mdTree))
    editor.copyToClipboard(js.new(js.window.Blob, {html}, {type="text/html"}))
  end
}

service.define {
  selector = "export",
  match = {
    name = "Clipboard: Export Clean Markdown",
    description = "To paste into another markdown supporting tool"
  },
  run = function(data)
    local mdTree = markdown.parseMarkdown(data.text)
    mdTree = markdown.expandMarkdown(mdTree)
    local renderedMd = markdown.renderParseTree(mdTree)
    editor.copyToClipboard(renderedMd)
  end
}
```
