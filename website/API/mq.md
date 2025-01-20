# Message Queue API

The Message Queue API provides functions for implementing a simple message queue system.

## Message Operations

### mq.send(queue, body)
Sends a message to a queue.

Example:
```lua
mq.send("tasks", {type = "process", data = "sample"})
```

### mq.batch_send(queue, bodies)
Sends multiple messages to a queue in a single operation.

Example:
```lua
local messages = {
    {type = "task1", data = "sample1"},
    {type = "task2", data = "sample2"}
}
mq.batch_send("tasks", messages)
```

### mq.ack(queue, id)
Acknowledges a message from a queue, marking it as processed.

Example:
```lua
mq.ack("tasks", "message-123")
```

### mq.batch_ack(queue, ids)
Acknowledges multiple messages from a queue in a single operation.

Example:
```lua
local messageIds = {"msg1", "msg2", "msg3"}
mq.batch_ack("tasks", messageIds)
```

## Queue Management

### mq.get_queue_stats(queue)
Retrieves statistics about a particular queue.

Example:
```lua
local stats = mq.get_queue_stats("tasks")
print("Queue size: " .. stats.size)
print("Processing: " .. stats.processing)
``` 