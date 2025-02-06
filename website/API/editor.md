The Editor API provides functions for interacting with the editor interface.

### editor.getCurrentPage()
Returns the name of the page currently open in the editor.

Example: ${editor.getCurrentPage()}

### editor.getCurrentPageMeta()
Returns the meta data of the page currently open in the editor.

Example:
${editor.getCurrentPageMeta()}

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

### editor.openSearchPanel()
Opens the editor's search panel.

Example:
```lua
editor.openSearchPanel()
