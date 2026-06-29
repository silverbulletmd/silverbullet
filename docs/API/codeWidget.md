---
tags: api/syscall
references:
- plug-api/syscalls/code_widget.ts
- client/plugos/syscalls/code_widget.ts
- client/plugos/syscalls/client_code_widget.ts
- client/codemirror/code_widget.ts
---

The Code Widget API provides functions for managing code widgets in the editor.

### codeWidget.refreshAll()
Refreshes all code widgets on the current page that support refreshing.

Example:
```lua
codeWidget.refreshAll()  -- Refresh all code widgets on the page
``` 