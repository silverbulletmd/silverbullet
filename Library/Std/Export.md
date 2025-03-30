#meta

Provides infrastructure for exporting pages outside of your space. It standardizes the ${widgets.commandButton("Export: Page Or Selection")} to export the current page or selection in various ways.

# Architecture
Flow:

1. Emit event `export:discover` with:
  * `pageMeta`
  * `selection` text
2. Respond with:
  * `id`: Call identifier
  * `name`
3. Ask user to select option, then invoke `export:run:${id}` with the same data as step 1
4. Exporter listens to this event and handles it as it sees fit.

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
    local handlers = event.dispatch("export:discover", exportObj)
    if #handlers == 0 then
      editor.flashNotification("No exporters available", "error")
      return
    end
    local selectionOptions = {}
    for _, handler in ipairs(handlers) do
      for _, option in ipairs(handler) do
        table.insert(selectionOptions, option)
      end
    end
    local selectedOption = editor.filterBox("Export to",
      selectionOptions, "Select your export mechanism")
    if not selectedOption then
      return
    end
    event.dispatch("export:run:" .. selectedOption.id, exportObj)
  end
}
```

# Clipboard exporters
Implements two exporters:
* Copy clean markdown
* Copy rich text (e.g. for pasting into a Google Docs)

```space-lua
event.listen {
  name = "export:discover",
  run = function(event)
    return {
      {
        id = "clipboard-clean-markdown",
        name = "Clipboard as clean markdown"
      },
      {
        id = "clipboard-rich-text",
        name = "Clipboard as rich text"
      },
    }
  end
}

event.listen {
  name = "export:run:clipboard-clean-markdown",
  run = function(event)
    local mdTree = markdown.parseMarkdown(event.data.text)
    mdTree = markdown.expandMarkdown(mdTree)
    local renderedMd = markdown.renderParseTree(mdTree)
    editor.copyToClipboard(renderedMd)
    editor.flashNotification "Copied markdown to clip board!"
  end
}

event.listen {
  name = "export:run:clipboard-rich-text",
  run = function(event)
    local mdTree = markdown.parseMarkdown(event.data.text)
    mdTree = markdown.expandMarkdown(mdTree)
    local html = markdown.markdownToHtml(markdown.renderParseTree(mdTree))
    editor.copyToClipboard(js.Blob({html}, {type="text/html"}))
    editor.flashNotification "Copied rich text to clip board!"
  end
}
```
