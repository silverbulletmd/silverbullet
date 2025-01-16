The `editor` API provides functions for interacting with the editor interface, including text manipulation, cursor control, and UI operations.

## Page Operations

### editor.get_current_page()
Returns the name of the page currently open in the editor.

Example:
```lua
local page = editor.get_current_page()
print("Current page: " .. page)
```

### editor.get_current_page_meta()
Returns the meta data of the page currently open in the editor.

Example:
```lua
local meta = editor.get_current_page_meta()
print("Last modified: " .. meta.last_modified)
```

## Text Operations

### editor.get_text()
Returns the full text of the currently open page.

Example:
```lua
local text = editor.get_text()
print("Document length: " .. #text)
```

### editor.set_text(text, isolate_history)
Updates the editor text while preserving cursor location.

Example:
```lua
local text = editor.get_text()
editor.set_text(text:upper(), false)  -- Convert to uppercase
```

### editor.insert_at_pos(text, pos)
Insert text at the specified position.

Example:
```lua
editor.insert_at_pos("Hello!", 0)  -- Insert at beginning
```

### editor.replace_range(from, to, text)
Replace text in the specified range.

Example:
```lua
editor.replace_range(0, 5, "New text")
```

### editor.insert_at_cursor(text)
Insert text at the current cursor position.

Example:
```lua
editor.insert_at_cursor("Inserted at cursor")
```

## Cursor Control

### editor.get_cursor()
Returns the cursor position as character offset.

Example:
```lua
local pos = editor.get_cursor()
print("Cursor at position: " .. pos)
```

### editor.get_selection()
Returns the current selection range.

Example:
```lua
local sel = editor.get_selection()
print("Selection from " .. sel.from .. " to " .. sel.to)
```

### editor.set_selection(from, to)
Sets the current selection range.

Example:
```lua
editor.set_selection(0, 10)  -- Select first 10 characters
```

### editor.move_cursor(pos, center)
Move the cursor to a specific position.

Example:
```lua
editor.move_cursor(0, true)  -- Move to start and center
```

### editor.move_cursor_to_line(line, column, center)
Move the cursor to a specific line and column.

Example:
```lua
editor.move_cursor_to_line(1, 1, true)  -- Move to start of first line
```

## Navigation

### editor.navigate(page_ref, replace_state, new_window)
Navigates to the specified page.

Example:
```lua
editor.navigate({page = "welcome"}, false, false)
```

### editor.open_page_navigator(mode)
Opens the page navigator.

Example:
```lua
editor.open_page_navigator("page")
```

### editor.open_command_palette()
Opens the command palette.

Example:
```lua
editor.open_command_palette()
```

## UI Operations

### editor.show_panel(id, mode, html, script)
Shows a panel in the editor.

Example:
```lua
editor.show_panel("rhs", 1, "<h1>Hello</h1>")
```

### editor.hide_panel(id)
Hides a panel in the editor.

Example:
```lua
editor.hide_panel("rhs")
```

### editor.flash_notification(message, type)
Shows a flash notification.

Example:
```lua
editor.flash_notification("Operation completed", "info")
```

### editor.prompt(message, default_value)
Prompts the user for input.

Example:
```lua
local name = editor.prompt("Enter your name:", "")
print("Hello, " .. name)
```

### editor.confirm(message)
Shows a confirmation dialog.

Example:
```lua
if editor.confirm("Are you sure?") then
    print("User confirmed")
end
```

## File Operations

### editor.download_file(filename, data_url)
Triggers a file download in the browser.

Example:
```lua
editor.download_file("test.txt", "data:text/plain;base64,SGVsbG8=")
```

### editor.upload_file(accept, capture)
Opens a file upload dialog.

Example:
```lua
local file = editor.upload_file(".txt", nil)
print("Uploaded: " .. file.name)
```

## Clipboard Operations

### editor.copy_to_clipboard(data)
Copies data to the clipboard.

Example:
```lua
editor.copy_to_clipboard("Copied text")
```

## Code Folding

### editor.fold()
Folds code at the current cursor position.

Example:
```lua
editor.fold()
```

### editor.unfold()
Unfolds code at the current cursor position.

Example:
```lua
editor.unfold()
```

### editor.toggle_fold()
Toggles code folding at the current position.

Example:
```lua
editor.toggle_fold()
```

### editor.fold_all()
Folds all foldable regions.

Example:
```lua
editor.fold_all()
```

### editor.unfold_all()
Unfolds all folded regions.

Example:
```lua
editor.unfold_all()
```

## History Operations

### editor.undo()
Undoes the last edit operation.

Example:
```lua
editor.undo()
```

### editor.redo()
Redoes the last undone operation.

Example:
```lua
editor.redo()
```

## Search Operations

### editor.open_search_panel()
Opens the editor's search panel.

Example:
```lua
editor.open_search_panel()
```

