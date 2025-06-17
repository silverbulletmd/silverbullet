The Editor API provides functions for interacting with the editor interface.

### editor.getCurrentPage()
Returns the name of the page currently open in the editor.

Example: ${editor.getCurrentPage()}

### editor.getCurrentPageMeta()
Returns the meta data of the page currently open in the editor.

Example:
${editor.getCurrentPageMeta()}

### editor.getCurrentPath(extension?)
Returns the name of the page or document currently open in the editor.

Parameters:
- `extension`: If true, returns page paths with their `.md` extension

Example:
```lua
local path = editor.getCurrentPath(true)
print(path)  -- prints: page.md
```

### editor.getCurrentEditor()
Returns the name of the currently open editor.

Example:
```lua
local editorName = editor.getCurrentEditor()
print(editorName)
```

### editor.getText()
Returns the full text of the currently open page.

Example:
```lua
local text = editor.getText()
print("Document length: " .. #text)
```

### editor.setText(text, isolateHistory)
Updates the editor text while preserving cursor location.

Example:
```lua
local text = editor.getText()
editor.setText(text:upper(), false)  -- Convert to uppercase
```

### editor.insertAtPos(text, pos)
Insert text at the specified position.

Example:
```lua
editor.insertAtPos("Hello!", 0)  -- Insert at beginning
```

### editor.replaceRange(from, to, text)
Replace text in the specified range.

Example:
```lua
editor.replaceRange(0, 5, "New text")
```

### editor.insertAtCursor(text, scrollIntoView?)
Insert text at the current cursor position.

Example:
```lua
editor.insertAtCursor("Inserted at cursor")
```

### editor.getCursor()
Returns the cursor position as character offset.

Example:
```lua
local pos = editor.getCursor()
print("Cursor at position: " .. pos)
```

### editor.getSelection()
Returns the current selection range.

Example:
```lua
local sel = editor.getSelection()
print("Selection from " .. sel.from .. " to " .. sel.to)
```

### editor.setSelection(from, to)
Sets the current selection range.

Example:
```lua
editor.setSelection(0, 10)  -- Select first 10 characters
```

### editor.moveCursor(pos, center)
Move the cursor to a specific position.

Example:
```lua
editor.moveCursor(0, true)  -- Move to start and center
```

### editor.moveCursorToLine(line, column, center)
Move the cursor to a specific line and column.

Example:
```lua
editor.moveCursorToLine(1, 1, true)  -- Move to start of first line
```

### editor.invokeCommand(name, args?)
Invokes a client command by name.

Example:
```lua
editor.invokeCommand("Stats: Show")
```

### editor.save()
Force saves the current page.

Example:
```lua
editor.save()
```

### editor.navigate(ref, replaceState?, newWindow?)
Navigates to the specified page reference.

Parameters:
- `ref`: The page reference to navigate to
- `replaceState`: Whether to replace the current history state
- `newWindow`: Whether to open in a new window

Example:
```lua
editor.navigate({ page: "other-page" })
```

### editor.openPageNavigator(mode)
Opens the page navigator.

Example:
```lua
editor.openPageNavigator("page")
```

### editor.openCommandPalette()
Opens the command palette.

Example:
```lua
editor.openCommandPalette()
```

### editor.reloadPage()
Force reloads the current page.

Example:
```lua
editor.reloadPage()
```

### editor.reloadUI()
Force reloads the browser UI.

Example:
```lua
editor.reloadUI()
```

### editor.rebuildEditorState()
Rebuilds the editor state to ensure the dispatch updates the state.

Example:
```lua
editor.rebuildEditorState()
```

### editor.reloadConfigAndCommands()
Reloads the config and commands, also in the server.

Example:
```lua
editor.reloadConfigAndCommands()
```

### editor.openUrl(url, existingWindow?)
Opens the specified URL in the browser.

Example:
```lua
editor.openUrl("https://example.com")
```

### editor.newWindow()
Opens a new window.

Example:
```lua
editor.newWindow()
```

### editor.goHistory(delta)
Moves in the browser history.

Example:
```lua
editor.goHistory(-1)  -- Go back
```

### editor.showPanel(id, mode, html, script)
Shows a panel in the editor.

Example:
```lua
editor.showPanel("rhs", 1, "<h1>Hello</h1>")
```

### editor.hidePanel(id)
Hides a panel in the editor.

Example:
```lua
editor.hidePanel("rhs")
```

### editor.flashNotification(message, type)
Shows a flash notification.

Example:
```lua
editor.flashNotification("Operation completed", "info")
```

### editor.downloadFile(filename, dataUrl)
Triggers a file download in the browser.

Example:
```lua
editor.downloadFile("test.txt", "data:text/plain;base64,SGVsbG8=")
```

### editor.uploadFile(accept, capture)
Opens a file upload dialog.

Example:
```lua
local file = editor.uploadFile(".txt", nil)
print("Uploaded: " .. file.name)
```

### editor.copyToClipboard(data)
Copies data to the clipboard.

Example:
```lua
editor.copyToClipboard("Copied text")
```

### editor.filterBox(label, options, helpText?, placeHolder?)
Shows a filter box UI.

Example:
```lua
local result = editor.filterBox("Select:", {
    { name="Option 1", value="1" },
    { name="Option 2", value="2", description="More details about 2" }
})
```

### editor.toggleFold()
Toggles code folding at the current position.

Example:
```lua
editor.toggleFold()
```

### editor.foldAll()
Folds all foldable regions.

Example:
```lua
editor.foldAll()
```

### editor.unfoldAll()
Unfolds all folded regions.

Example:
```lua
editor.unfoldAll()
```

### editor.undo()
Undoes the last change.

Example:
```lua
editor.undo()
```

### editor.redo()
Redoes the last undone change.

Example:
```lua
editor.redo()
```

### editor.openSearchPanel()
Opens the editor's search panel.

Example:
```lua
editor.openSearchPanel()
```

### editor.deleteLine()
Deletes the current line.

Example:
```lua
editor.deleteLine()
```

### editor.moveLineUp()
Moves the current line up.

Example:
```lua
editor.moveLineUp()
```

### editor.moveLineDown()
Moves the current line down.

Example:
```lua
editor.moveLineDown()
```

### editor.vimEx(exCommand)
Executes a Vim ex command.

Example:
```lua
editor.vimEx(":w")
```

### editor.sendMessage(type, data?)
Sends a message to the editor.

Example:
```lua
editor.sendMessage("custom-event", { data: "value" })
```

### editor.prompt(message, defaultValue?)
Shows a prompt dialog.

Example:
```lua
local result = editor.prompt("Enter your name:", "John")
```

### editor.confirm(message)
Shows a confirmation dialog.

Example:
```lua
local confirmed = editor.confirm("Are you sure?")
```

### editor.alert(message)
Shows an alert dialog.

Example:
```lua
editor.alert("Operation completed")
```

### editor.getUiOption(key)
Gets a UI option value.

Example:
```lua
local theme = editor.getUiOption("theme")
```

### editor.setUiOption(key, value)
Sets a UI option value.

Example:
```lua
editor.setUiOption("theme", "dark")
```
