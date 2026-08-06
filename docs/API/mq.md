---
tags: api/space-lua
references:
- plug-api/syscalls/mq.ts
- client/plugos/syscalls/mq.ts
- client/data/mq.datastore.ts
---

The Message Queue API provides functions for implementing a simple message queue system.

<!--#lua spacelua.renderApiDocumentation("mq") -->
## mq.ack

`mq.ack(queue, id)`

Acknowledges one queue message as processed.

**Parameters:**

- `queue` (`string`) — Queue name.
- `id` (`string`) — Message ID.

## mq.awaitEmptyQueue

`mq.awaitEmptyQueue(queue)`

Waits until a queue has no pending or processing messages.

**Parameters:**

- `queue` (`string`) — Queue name.

## mq.batchAck

`mq.batchAck(queue, ids)`

Acknowledges multiple queue messages as processed.

**Parameters:**

- `queue` (`string`) — Queue name.
- `ids` (`table`) — Message IDs.

## mq.batchSend

`mq.batchSend(queue, bodies)`

Sends multiple messages to a queue in one operation.

**Parameters:**

- `queue` (`string`) — Queue name.
- `bodies` (`table`) — Message bodies.

## mq.flushAllQueues

`mq.flushAllQueues()`

Removes all messages from every queue.

## mq.flushQueue

`mq.flushQueue(queue)`

Removes all messages from a queue.

**Parameters:**

- `queue` (`string`) — Queue name.

## mq.getQueueStats

`mq.getQueueStats(queue?)`

Gets queued, processing, and dead-letter counts for a queue.

**Parameters:**

- `queue?` (`string`) — Queue name.

**Returns:**

- `table` — Queue statistics.

## mq.send

`mq.send(queue, body)`

Sends a message to a queue.

**Parameters:**

- `queue` (`string`) — Queue name.
- `body` — Message body.

**Example:**

```lua
mq.send("tasks", "my task")
```

## mq.subscribe

`mq.subscribe(spec)`

Subscribes a Space Lua callback to a message queue.

**Parameters:**

- `spec` (`table`) — Subscription with queue, optional batchSize and pollInterval, autoAck (default true), and a run(messages) callback; each message has queue, id, and body fields.

**Example:**

```lua
mq.subscribe { queue = "tasks", batchSize = 1, run = function(messages) print(messages[1].body) end }
```
<!--/lua-->

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

