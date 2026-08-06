---
tags: api/syscall
references:
- plug-api/syscalls/event.ts
- client/plugos/syscalls/event.ts
- client/plugos/event.ts
---

The Event API provides functions for working with SilverBullet's event bus system, allowing communication between different parts of the application.

<!--#lua spacelua.renderApiDocumentation("event") -->
## event.dispatch

`event.dispatch(eventName, data)`

Dispatches an event and collects responses from its listeners.

**Parameters:**

- `eventName` (`string`) — Event name.
- `data` — Event payload.

**Returns:**

- `table` — Listener responses.

**Example:**

```lua
local responses = event.dispatch("data.request", {id = 123})
```

## event.listEvents

`event.listEvents()`

Lists all event names that currently have listeners.

**Returns:**

- `table` — Registered event names.

## event.listen

`event.listen(listener)`

Registers a Space Lua listener on the event bus.

**Parameters:**

- `listener` (`table`) — Listener definition with name and run callback.

**Example:**

```lua
event.listen { name = "my-event", run = function(e) print(e.data) end }
```
<!--/lua-->

