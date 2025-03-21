# Event API

The Event API provides functions for working with SilverBullet's event bus system, allowing communication between different parts of the application.

## Notable events to listen to:

* `page:click` - Fired when a user clicks somehwere in the page.
* `editor:complete` - Fired when the editor requests code completion.
* `editor:pageSaving` - Fired when the editor is saving a page.
* `editor:pageSaved` - Fired when the editor has saved a page.
* `editor:pageCreating` - Fired when the editor is creating a new page.
* `editor:pageModified` - Fired when the editor modifies a page.
* `editor:documentSaving` - Fired when the editor is saving a document.
* `editor:documentSaved` - Fired when the editor has saved a document.
* `cron:secondPassed` - Fired every second.
* `hooks:renderTopWidgets` - Fired when rendering top widgets.
* `hooks:renderBottomWidgets` - Fired when rendering bottom widgets.
* `system:ready` - Fired when all plugs are loaded.

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
