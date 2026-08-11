---
tags: api/syscall
references:
- plug-api/syscalls/editor.ts
- client/plugos/syscalls/editor.ts
- plugs/editor/editor.ts
- plugs/editor/navigate.ts
---

The Editor API provides functions for interacting with the editor interface.

<!--#lua spacelua.renderApiDocumentation("editor") -->
## editor.acceptCompletion

`editor.acceptCompletion()`

Accepts the currently selected completion when the completion popup is active.

**Returns:**

- `boolean` — Whether an active completion was accepted.

## editor.alert

`editor.alert(message)`

Shows a browser alert dialog.

**Parameters:**

- `message` (`string`) — The alert message.

## editor.closeCompletion

`editor.closeCompletion()`

Closes the active editor completion popup.

## editor.configureVimMode

`editor.configureVimMode()`

Configures CodeMirror Vim mode from the current SilverBullet Vim settings.

## editor.confirm

`editor.confirm(message, options?)`

Prompts the user to confirm or cancel an action.

**Parameters:**

- `message` (`string`) — The confirmation message.
- `options?` (`{ destructive?: boolean }`) — Optional dialog styling settings.

**Returns:**

- `boolean` — Whether the user confirmed.

## editor.copyToClipboard

`editor.copyToClipboard(data)`

Copies text or binary Blob data to the system clipboard. Clipboard access requires a secure HTTPS context.

**Parameters:**

- `data` (`string | Blob`) — The text or Blob to copy.

**Example:**

```lua
editor.copyToClipboard("Copied text")
```

## editor.cursorCharLeft

`editor.cursorCharLeft()`

Moves the cursor one character left, respecting bidirectional text.

## editor.cursorCharRight

`editor.cursorCharRight()`

Moves the cursor one character right, respecting bidirectional text.

## editor.cursorDocEnd

`editor.cursorDocEnd()`

Moves the cursor to the end of the document.

## editor.cursorDocStart

`editor.cursorDocStart()`

Moves the cursor to the start of the document.

## editor.cursorGroupLeft

`editor.cursorGroupLeft()`

Moves the cursor left by one character group or word.

## editor.cursorGroupRight

`editor.cursorGroupRight()`

Moves the cursor right by one character group or word.

## editor.cursorLineBoundaryLeft

`editor.cursorLineBoundaryLeft()`

Moves the cursor to the left visual boundary of the current line.

## editor.cursorLineBoundaryRight

`editor.cursorLineBoundaryRight()`

Moves the cursor to the right visual boundary of the current line.

## editor.cursorLineDown

`editor.cursorLineDown()`

Moves completion selection down when open, otherwise moves the cursor down one visual line.

## editor.cursorLineEnd

`editor.cursorLineEnd()`

Moves the cursor to the end of the current logical line.

## editor.cursorLineStart

`editor.cursorLineStart()`

Moves the cursor to the start of the current logical line.

## editor.cursorLineUp

`editor.cursorLineUp()`

Moves completion selection up when open, otherwise moves the cursor up one visual line.

## editor.cursorPageDown

`editor.cursorPageDown()`

Moves completion selection down one page when open, otherwise moves the cursor down one viewport page.

## editor.cursorPageUp

`editor.cursorPageUp()`

Moves completion selection up one page when open, otherwise moves the cursor up one viewport page.

## editor.deleteCharBackward

`editor.deleteCharBackward()`

Deletes the selection or the character before the cursor.

## editor.deleteCharForward

`editor.deleteCharForward()`

Deletes the selection or the character after the cursor.

## editor.deleteGroupBackward

`editor.deleteGroupBackward()`

Deletes the selection or the character group before the cursor.

## editor.deleteGroupForward

`editor.deleteGroupForward()`

Deletes the selection or the character group after the cursor.

## editor.deleteLine

`editor.deleteLine()`

Deletes the current line or the lines touched by the selection.

## editor.deleteLineBoundaryBackward

`editor.deleteLineBoundaryBackward()`

Deletes the selection or text back to the current line boundary.

## editor.deleteLineBoundaryForward

`editor.deleteLineBoundaryForward()`

Deletes the selection or text forward to the current line boundary.

## editor.dispatch

`editor.dispatch(change)`

Dispatches a CodeMirror transaction to the editor view.

**Parameters:**

- `change` (`Transaction`) — The CodeMirror transaction to dispatch.

## editor.downloadFile

`editor.downloadFile(filename, dataUrl)`

Triggers a browser download of a data URL under the given filename.

**Parameters:**

- `filename` (`string`) — The downloaded filename.
- `dataUrl` (`string`) — The data URL to download.

**Example:**

```lua
editor.downloadFile("test.txt", "data:text/plain;base64,SGVsbG8=")
```

## editor.filterBox

`editor.filterBox(label, options, helpText?, placeHolder?)`

Shows a filterable option picker similar to the page navigator.

**Parameters:**

- `label` (`string`) — The label shown beside the filter input.
- `options` (`FilterOption[]`) — The available options.
- `helpText?` (`string`) — Help text shown below the picker.
- `placeHolder?` (`string`) — Placeholder text for the filter input.

**Returns:**

- `FilterOption | undefined` — The selected option, or undefined if dismissed.

**Example:**

```lua
local result = editor.filterBox("Select:", {
  {name = "Option 1", value = "1"},
  {name = "Option 2", value = "2", description = "More details"}
})
```

## editor.flashNotification

`editor.flashNotification(message, type?, options?)`

Shows a flash notification in the editor UI.

**Parameters:**

- `message` (`string`) — The message to display.
- `type?` (`NotificationType`) — The notification severity: "info", "error", or "warning".
- `options?` (`{ timeout?: number; actions?: NotificationAction[] }`) — Optional timeout and action buttons. A timeout of 0 keeps the notification visible until dismissed.

**Example:**

```lua
editor.flashNotification("Update available", "warning", {
  timeout = 0,
  actions = {{
    name = "Reload",
    run = function() editor.reloadUI() end
  }}
})
```

## editor.focus

`editor.focus()`

Returns focus to the main editor.

## editor.fold

`editor.fold()`

Folds the code or markup region at the cursor.

## editor.foldAll

`editor.foldAll()`

Folds all foldable regions in the editor.

## editor.forceLint

`editor.forceLint()`

Forces editor linting to run, including when the content has not changed.

## editor.getCurrentEditor

`editor.getCurrentEditor()`

Returns the name of the currently active editor implementation.

**Returns:**

- `string` — The editor name, or `page` for the page editor.

## editor.getCurrentLine

`editor.getCurrentLine()`

Returns the current line's range and text, including a `|^|` cursor marker variant.

**Returns:**

- `{ from: number; to: number; text: string; textWithCursor: string }` — The line containing the main selection head.

## editor.getCurrentPage

`editor.getCurrentPage()`

Returns the name of the page or document currently open in the editor.

**Returns:**

- `string` — The current page name.

## editor.getCurrentPageMeta

`editor.getCurrentPageMeta()`

Returns metadata for the page or document currently open in the editor.

**Returns:**

- `PageMeta | undefined` — The current page metadata, if indexed.

## editor.getCurrentPath

`editor.getCurrentPath()`

Returns the path of the page or document currently open in the editor.

**Returns:**

- `string` — The current page path.

## editor.getCursor

`editor.getCursor()`

Returns the cursor position as a character offset from the start of the document.

**Returns:**

- `number` — The cursor offset.

## editor.getFocusedPanelSlot

`editor.getFocusedPanelSlot()`

Returns the slot of the panel (keyed or legacy) whose iframe currently holds focus, or undefined if none does.

**Returns:**

- `"lhs" | "rhs" | "bhs" | "modal" | undefined` — The focused panel's slot, or undefined if no panel iframe has focus.

## editor.getLastOpenedMap

`editor.getLastOpenedMap()`

Returns a map of page name to the time it was last opened (epoch milliseconds), for the pages that have ever been opened on this client. This lives outside the object index.

**Returns:**

- `Record<string, number>` — Page name to last-opened timestamp.

## editor.getRecentlyOpenedPages

`editor.getRecentlyOpenedPages()`

Returns page metadata ordered from most to least recently opened.

**Returns:**

- `PageMeta[]` — Recently opened pages.

## editor.getSelection

`editor.getSelection()`

Returns the current selection range and selected text.

**Returns:**

- `{ from: number; to: number; text: string }` — The main editor selection.

## editor.getText

`editor.getText()`

Returns the full text of the currently open page or document.

**Returns:**

- `string` — The editor contents.

## editor.getUiOption

`editor.getUiOption(key)`

Returns the current value of an editor UI option.

**Parameters:**

- `key` (`string`) — The UI option key.

**Returns:**

- `any` — The option value.

## editor.getViewableExtensions

`editor.getViewableExtensions()`

Returns the file extensions that have a document editor registered, i.e. the documents this client can actually open. Extensions carry no leading dot. Which editors are loaded depends on the plugs installed, so this is a property of the client rather than of the space.

**Returns:**

- `string[]` — Extensions with a registered document editor.

## editor.goHistory

`editor.goHistory(delta)`

Moves backward or forward through browser history.

**Parameters:**

- `delta` (`number`) — The relative history offset; negative moves backward and positive moves forward.

## editor.hidePanel

`editor.hidePanel(id, expectedActivationId?)`

Hides the panel at a specified editor UI location.

**Parameters:**

- `id` (`string`) — The panel location identifier.
- `expectedActivationId?` (`string | number`) — If given, only hides when the currently visible keyed panel for this slot still carries this activation id (see editor.showPanel's activationId option) -- otherwise a no-op, since something newer has already taken the slot.

## editor.indentLess

`editor.indentLess()`

Decreases indentation for the current line or selection.

## editor.indentMore

`editor.indentMore()`

Increases indentation for the current line or selection.

## editor.insertAtCursor

`editor.insertAtCursor(text, scrollIntoView?, cursorPlaceHolder?)`

Inserts text at the cursor and moves the cursor after it or to an optional `|^|` marker.

**Parameters:**

- `text` (`string`) — The text to insert.
- `scrollIntoView?` (`boolean`) — Whether to scroll the new cursor position into view.
- `cursorPlaceHolder?` (`boolean`) — Whether to remove `|^|` and move the cursor to its position.

## editor.insertAtPos

`editor.insertAtPos(text, pos, cursorPlaceHolder?)`

Inserts text at a character offset, optionally placing the cursor at a `|^|` marker.

**Parameters:**

- `text` (`string`) — The text to insert.
- `pos` (`number`) — The character offset at which to insert.
- `cursorPlaceHolder?` (`boolean`) — Whether to remove `|^|` and move the cursor to its position.

## editor.insertNewline

`editor.insertNewline()`

Accepts the active completion, or inserts a newline with appropriate indentation.

## editor.invokeCommand

`editor.invokeCommand(name, args?)`

Invokes a client command by name.

**Parameters:**

- `name` (`string`) — The command name.
- `args?` (`string[]`) — Arguments passed to the command.

## editor.isMobile

`editor.isMobile()`

Checks whether the current device lacks a fine pointer and should be treated as mobile.

**Returns:**

- `boolean` — Whether the editor is running in a mobile-style pointer environment.

## editor.isNarrowScreen

`editor.isNarrowScreen()`

Checks whether the client is currently laid out for a narrow screen, i.e. below the breakpoint where sidebar panels become full-width drawers.

**Returns:**

- `boolean` — Whether the narrow-screen layout is in effect.

## editor.moveCursor

`editor.moveCursor(pos, center?)`

Moves and focuses the cursor at a character offset, scrolling it into view.

**Parameters:**

- `pos` (`number`) — The character offset to move to.
- `center?` (`boolean`) — Whether to vertically center the cursor.

## editor.moveCursorToLine

`editor.moveCursorToLine(line, column?, center?)`

Moves the cursor to a one-based line and column, clamping the column to the line length.

**Parameters:**

- `line` (`number`) — The one-based line number.
- `column?` (`number`) — The one-based column number.
- `center?` (`boolean`) — Whether to vertically center the cursor.

## editor.moveLineDown

`editor.moveLineDown()`

Moves the current line or selected lines downward.

## editor.moveLineUp

`editor.moveLineUp()`

Moves the current line or selected lines upward.

## editor.navigate

`editor.navigate(ref, replaceState?, newWindow?)`

Navigates to a page reference without restoring its remembered cursor and scroll position.

**Parameters:**

- `ref` (`Ref | string`) — The page reference to navigate to.
- `replaceState?` (`boolean`) — Whether to replace the current browser history state.
- `newWindow?` (`boolean`) — Whether to open the reference in a new window.

**Example:**

```lua
editor.navigate("CHANGELOG@123")
```

## editor.newWindow

`editor.newWindow()`

Opens the current SilverBullet URL in a new browser window.

## editor.open

`editor.open(ref, replaceState?, newWindow?)`

Opens a page reference and restores its remembered cursor and scroll position when possible.

**Parameters:**

- `ref` (`Ref | string`) — The page reference to open.
- `replaceState?` (`boolean`) — Whether to replace the current browser history state.
- `newWindow?` (`boolean`) — Whether to open the reference in a new window.

**Example:**

```lua
editor.open("CHANGELOG")
```

## editor.openCommandPalette

`editor.openCommandPalette()`

Opens the command palette.

## editor.openNavigator

`editor.openNavigator(name, opts?)`

Opens a navigator view, returning whether it opened. False means the view isn't there to open -- typically because it's defined in Space Lua that hasn't been indexed yet -- so a caller can fall back to something else.

**Parameters:**

- `name` (`string`) — The view's name.
- `opts?` (`table`) — Optional `segment` (segment label) and `phrase`.

**Returns:**

- `boolean` — Whether a view opened.

## editor.openPageNavigator

`editor.openPageNavigator(mode?)`

Opens the page picker in the requested browsing mode. Each mode maps to a segment of the `std.pages` navigator view.

**Parameters:**

- `mode?` (`page | meta | document | all`) — The navigator mode.

## editor.openSearchPanel

`editor.openSearchPanel()`

Opens the editor's native search panel.

## editor.openUrl

`editor.openUrl(url, existingWindow?)`

Opens a URL in the browser.

**Parameters:**

- `url` (`string`) — The URL to open.
- `existingWindow?` (`boolean`) — Whether to reuse an existing window.

## editor.panelReady

`editor.panelReady(id, activationId?)`

Paint-gated reveal handshake: signals that the keyed panel at the given slot has rendered its first real content for the given activation, so the host can reveal it (see editor.showPanel's gated paintReady).

**Parameters:**

- `id` (`string`) — The panel location identifier.
- `activationId?` (`string | number`) — The activation this panel is signalling readiness for (see editor.showPanel's activationId option) -- ignored if a newer activation has since taken the slot.

## editor.prompt

`editor.prompt(message, defaultValue?)`

Prompts the user for text input.

**Parameters:**

- `message` (`string`) — The prompt message.
- `defaultValue?` (`string`) — The initial input value.

**Returns:**

- `string | undefined` — The entered text, or undefined if dismissed.

## editor.rebuildEditorState

`editor.rebuildEditorState()`

Rebuilds the CodeMirror editor state from the current client configuration.

## editor.redo

`editor.redo()`

Redoes the most recently undone editor change.

## editor.reloadConfigAndCommands

`editor.reloadConfigAndCommands()`

Reloads space scripts and styles, then rebuilds the editor state.

## editor.reloadPage

`editor.reloadPage()`

Force reloads the current page in the editor.

## editor.reloadUI

`editor.reloadUI()`

Force reloads the browser UI.

## editor.replaceRange

`editor.replaceRange(from, to, text, cursorPlaceHolder?)`

Replaces a text range, optionally placing the cursor at a `|^|` marker in the replacement.

**Parameters:**

- `from` (`number`) — The start offset of the range.
- `to` (`number`) — The end offset of the range.
- `text` (`string`) — The replacement text.
- `cursorPlaceHolder?` (`boolean`) — Whether to remove `|^|` and move the cursor to its position.

## editor.save

`editor.save()`

Forces the current page or document to be saved.

## editor.selectAll

`editor.selectAll()`

Selects the entire editor document.

## editor.selectCharLeft

`editor.selectCharLeft()`

Extends the selection one character left, respecting bidirectional text.

## editor.selectCharRight

`editor.selectCharRight()`

Extends the selection one character right, respecting bidirectional text.

## editor.selectDocEnd

`editor.selectDocEnd()`

Extends the selection to the end of the document.

## editor.selectDocStart

`editor.selectDocStart()`

Extends the selection to the start of the document.

## editor.selectGroupLeft

`editor.selectGroupLeft()`

Extends the selection left by one character group or word.

## editor.selectGroupRight

`editor.selectGroupRight()`

Extends the selection right by one character group or word.

## editor.selectLineBoundaryLeft

`editor.selectLineBoundaryLeft()`

Extends the selection to the left visual boundary of the current line.

## editor.selectLineBoundaryRight

`editor.selectLineBoundaryRight()`

Extends the selection to the right visual boundary of the current line.

## editor.selectLineDown

`editor.selectLineDown()`

Extends the selection downward by one visual line.

## editor.selectLineEnd

`editor.selectLineEnd()`

Extends the selection to the end of the current logical line.

## editor.selectLineStart

`editor.selectLineStart()`

Extends the selection to the start of the current logical line.

## editor.selectLineUp

`editor.selectLineUp()`

Extends the selection upward by one visual line.

## editor.selectPageDown

`editor.selectPageDown()`

Extends the selection downward by one viewport page.

## editor.selectPageUp

`editor.selectPageUp()`

Extends the selection upward by one viewport page.

## editor.sendMessage

`editor.sendMessage(type, data?)`

Sends a public message to the active document editor, if one is open.

**Parameters:**

- `type` (`string`) — The message type.
- `data?` (`any`) — Data attached to the message.

## editor.setSelection

`editor.setSelection(from, to)`

Sets the main editor selection to a character range.

**Parameters:**

- `from` (`number`) — The selection anchor offset.
- `to` (`number`) — The selection head offset.

## editor.setText

`editor.setText(newText, shouldIsolateHistory?)`

Updates the editor text with a minimal diff while preserving the cursor when possible.

**Parameters:**

- `newText` (`string`) — The complete replacement text.
- `shouldIsolateHistory?` (`boolean`) — Whether to isolate the change in undo history.

## editor.setUiOption

`editor.setUiOption(key, value)`

Sets an editor UI option and reloads the editor.

**Parameters:**

- `key` (`string`) — The UI option key.
- `value` (`any`) — The option value.

## editor.showPanel

`editor.showPanel(id, mode, html, script, options?)`

Shows an HTML panel in a specified editor UI location.

**Parameters:**

- `id` (`string`) — The panel location identifier.
- `mode` (`number | string`) — The panel display mode or size.
- `html` (`HTMLElement | HTMLElement[] | string`) — The panel content.
- `script` (`string`) — A script associated with the panel content.
- `options?` (`PanelOptions`) — Optional keyed-panel options: key for persistent identity, preload to mount hidden, events to forward, activationId to pair with a later editor.hidePanel call.

## editor.showProgress

`editor.showProgress(progressType, progressPercentage?)`

Shows, updates, or hides a sync or indexing progress indicator.

**Parameters:**

- `progressType` (`sync | index`) — The operation represented by the indicator.
- `progressPercentage?` (`number`) — Completion percentage, or undefined to hide the indicator.

## editor.startCompletion

`editor.startCompletion()`

Explicitly starts editor completion at the cursor.

## editor.toggleComment

`editor.toggleComment()`

Comments or uncomments the current line or selection.

## editor.toggleFold

`editor.toggleFold()`

Toggles folding for the region at the cursor.

## editor.transposeChars

`editor.transposeChars()`

Transposes the characters around the cursor.

## editor.undo

`editor.undo()`

Undoes the most recent editor change.

## editor.unfold

`editor.unfold()`

Unfolds the folded region at the cursor.

## editor.unfoldAll

`editor.unfoldAll()`

Unfolds all folded regions in the editor.

## editor.updateBakedSections

`editor.updateBakedSections()`

Re-evaluates every baked section on the current page and replaces each body with its latest output.

## editor.uploadFile

`editor.uploadFile(accept?, capture?)`

Opens the browser's native file picker and returns the selected file's bytes and metadata.

**Parameters:**

- `accept?` (`string`) — Accepted file types for the file input.
- `capture?` (`string`) — The media capture mode for the file input.

**Returns:**

- `UploadFile` — The selected file's name, content type, and bytes.

**Example:**

```lua
local file = editor.uploadFile(".txt")
print(file.name)
```

## editor.vimEx

`editor.vimEx(exCommand)`

Executes a Vim Ex command in the active Vim-mode editor.

**Parameters:**

- `exCommand` (`string`) — The Ex command to execute.
<!--/lua-->

