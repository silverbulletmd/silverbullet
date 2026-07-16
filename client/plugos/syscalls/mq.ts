import type { DataStoreMQ } from "../../data/mq.datastore.ts";
import type { MQListenerSpec } from "../hooks/mq.ts";
import type { SysCallMapping } from "../system.ts";

export type EventSubscription = MQListenerSpec & {
  run: (...args: any[]) => Promise<any>;
};

export function mqSyscalls(mq: DataStoreMQ): SysCallMapping {
  return {
    /**
     * Define a Lua event listener
     */
    "mq.subscribe": {
      callback: (_ctx, def: MQListenerSpec) => {
        def.autoAck = def.autoAck !== false;
        // console.log("Registering Lua event listener: ", def.name);
        client.config.insert(["mqSubscriptions", def.queue], def);
      },
      description: "Subscribes a Space Lua callback to a message queue.",
      parameters: [
        {
          name: "spec",
          type: "table",
          description:
            "Subscription with queue, optional batchSize and pollInterval, autoAck (default true), and a run(messages) callback; each message has queue, id, and body fields.",
        },
      ],
      examples: [
        {
          code: 'mq.subscribe { queue = "tasks", batchSize = 1, run = function(messages) print(messages[1].body) end }',
        },
      ],
    },
    "mq.send": {
      callback: (_ctx, queue: string, body: any) => {
        return mq.send(queue, body);
      },
      description: "Sends a message to a queue.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
        { name: "body", description: "Message body." },
      ],
      examples: [{ code: 'mq.send("tasks", "my task")' }],
    },
    "mq.batchSend": {
      callback: (_ctx, queue: string, bodies: any[]) => {
        return mq.batchSend(queue, bodies);
      },
      description: "Sends multiple messages to a queue in one operation.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
        { name: "bodies", type: "table", description: "Message bodies." },
      ],
    },
    "mq.ack": {
      callback: (_ctx, queue: string, id: string) => {
        return mq.ack(queue, id);
      },
      description: "Acknowledges one queue message as processed.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
        { name: "id", type: "string", description: "Message ID." },
      ],
    },
    "mq.batchAck": {
      callback: (_ctx, queue: string, ids: string[]) => {
        return mq.batchAck(queue, ids);
      },
      description: "Acknowledges multiple queue messages as processed.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
        { name: "ids", type: "table", description: "Message IDs." },
      ],
    },
    "mq.flushQueue": {
      callback: (_ctx, queue: string) => {
        return mq.flushQueue(queue);
      },
      description: "Removes all messages from a queue.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
      ],
    },
    "mq.flushAllQueues": {
      callback: () => {
        return mq.flushAllQueues();
      },
      description: "Removes all messages from every queue.",
    },
    "mq.getQueueStats": {
      callback: (_ctx, queue: string) => {
        return mq.getQueueStats(queue);
      },
      description:
        "Gets queued, processing, and dead-letter counts for a queue.",
      parameters: [
        {
          name: "queue",
          type: "string",
          description: "Queue name.",
          optional: true,
        },
      ],
      returns: [{ type: "table", description: "Queue statistics." }],
    },
    "mq.awaitEmptyQueue": {
      callback: (_ctx, queue: string) => {
        return mq.awaitEmptyQueue(queue);
      },
      description: "Waits until a queue has no pending or processing messages.",
      parameters: [
        { name: "queue", type: "string", description: "Queue name." },
      ],
    },
  };
}
