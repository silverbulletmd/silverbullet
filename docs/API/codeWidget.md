---
tags: api/syscall
references:
- plug-api/syscalls/code_widget.ts
- client/plugos/syscalls/code_widget.ts
- client/plugos/syscalls/client_code_widget.ts
- client/codemirror/code_widget.ts
---

The Code Widget API provides functions for managing code widgets in the editor.

<!--#lua spacelua.renderApiDocumentation("codeWidget") -->
## codeWidget.define

`codeWidget.define(def)`

**Parameters:**

- `def`

## codeWidget.refreshAll

`codeWidget.refreshAll()`

Refreshes all code widgets on the current page that support refreshing.

**Example:**

```lua
codeWidget.refreshAll()
```

## codeWidget.render

`codeWidget.render(language, body, pageName)`

Renders code through the widget registered for a language.

**Parameters:**

- `language` (`string`) — Widget language.
- `body` (`string`) — Code block body.
- `pageName` (`string`) — Containing page name.

**Returns:**

- `table` — Rendered widget content, or nil.
<!--/lua-->

