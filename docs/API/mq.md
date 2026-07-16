---
tags: api/space-lua
references:
- plug-api/syscalls/mq.ts
- client/plugos/syscalls/mq.ts
- client/data/mq.datastore.ts
---

The Message Queue API provides functions for implementing a simple message queue system.

${spacelua.renderApiDocumentation("mq")}

## Example

```space-lua
mq.subscribe {
  queue = "testqueue",
  batchSize = 1,
  run = function(messages)
    for _, msg in ipairs(messages) do
      editor.flashNotification("Received message: " .. msg.body)
    end
  end
}
```

${widgets.button("Send message on queue", function()
  mq.send("testqueue", "Hello world")
end)}
