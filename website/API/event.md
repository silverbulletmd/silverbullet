# Event API

The Event API provides functions for working with SilverBullet's event bus system, allowing communication between different parts of the application.

## Event Operations

### event.listen(listenerDef)
Register an event listener.

```lua
event.listen {
  name = "my-event",
  run = function(e)
    print("Data", e.data)
  end
}
```

### event.dispatch(eventName, data, timeout)
Triggers an event on the SilverBullet event bus. Event handlers can return values, which are accumulated and returned to the caller.

Example:
```lua
-- Simple event dispatch
event.dispatch("custom.event", {message = "Hello"})

-- Event dispatch with timeout and response handling
local responses = event.dispatchEvent("data.request", {id = 123}, 5000)
for _, response in ipairs(responses) do
    print(response)
end
```

### event.listEvents()
Lists all events currently registered (listened to) on the SilverBullet event bus.

Example:
```lua
local events = event.listEvents()
for _, eventName in ipairs(events) do
    print("Registered event: " .. eventName)
end
