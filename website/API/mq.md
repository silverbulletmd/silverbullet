# Message Queue API
The Message Queue API provides functions for implementing a simple message queue system.

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

## API
### mq.subscribe(spec)
Subscribe to a queue. Spec keys:

* `queue`: name of the queue to subscribe to
* `batchSize`: maximum number of messages to ingest per run
* `autoAck`: (defaults to `true`), whether to automatically acknowledge a message if no error occurs during processing
* `run`: callback with the function to run, will receive a `messages` argument where each message is a table containing:
  * `queue`: name of the queue the message was sent to
  * `id`: message id
  * `body`: message body

### mq.send(queue, body)
Sends a message to a queue.

Example:
```lua
mq.send("tasks", "my task")
```

### mq.batchSend(queue, bodies)
Sends multiple messages to a queue in a single operation.

Example:
```lua
mq.batchSend("tasks", {"task 1", "task 2" })
```

### mq.ack(queue, id)
Acknowledges a message from a queue, marking it as processed.

Example:
```lua
mq.ack("tasks", "message-123")
```

### mq.batchAck(queue, ids)
Acknowledges multiple messages from a queue in a single operation.

Example:
```lua
mq.batchAck("tasks", {"msg1", "msg2", "msg3"})
```

## Queue Management

### mq.getQueueStats(queue)
Retrieves statistics about a particular queue.

Example:
```lua
local stats = mq.getQueueStats("tasks")
print("Queue size: " .. stats.size)
print("Processing: " .. stats.processing)
```

### mq.awaitEmptyQueue(queue)
Waits for a queue to become empty.

Example:
```lua
mq.awaitEmptyQueue("tasks")
```