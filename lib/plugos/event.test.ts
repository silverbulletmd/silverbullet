import { assert, assertEquals } from "@std/assert";
import { EventEmitter } from "./event.ts";

// Test event handler interfaces
interface TestEvents {
  message: (content: string) => void | Promise<void>;
  count: (num: number) => void | Promise<void>;
  multi: (a: string, b: number, c: boolean) => void | Promise<void>;
  async: () => void | Promise<void>;
  sync: () => void | Promise<void>;
  error: () => void | Promise<void>;
}

// Concrete test implementation
class TestEventEmitter extends EventEmitter<TestEvents> {
  // Just a concrete implementation for testing
}

Deno.test("EventEmitter - basic on/emit functionality", async () => {
  const emitter = new TestEventEmitter();
  let received = "";
  let count = 0;

  emitter.on({
    message: (content: string) => {
      received = content;
    },
    count: (num: number) => {
      count = num;
    },
  });

  await emitter.emit("message", "hello world");
  assertEquals(received, "hello world");

  await emitter.emit("count", 42);
  assertEquals(count, 42);
});

Deno.test("EventEmitter - multiple handlers for same event", async () => {
  const emitter = new TestEventEmitter();
  const results: string[] = [];

  emitter.on({
    message: (content: string) => {
      results.push(`handler1: ${content}`);
    },
  });

  emitter.on({
    message: (content: string) => {
      results.push(`handler2: ${content}`);
    },
  });

  await emitter.emit("message", "test");

  assertEquals(results.length, 2);
  assertEquals(results[0], "handler1: test");
  assertEquals(results[1], "handler2: test");
});

Deno.test("EventEmitter - multiple events in single handler", async () => {
  const emitter = new TestEventEmitter();
  let messageReceived = "";
  let countReceived = 0;

  emitter.on({
    message: (content: string) => {
      messageReceived = content;
    },
    count: (num: number) => {
      countReceived = num;
    },
  });

  await emitter.emit("message", "multi-handler");
  await emitter.emit("count", 123);

  assertEquals(messageReceived, "multi-handler");
  assertEquals(countReceived, 123);
});

Deno.test("EventEmitter - emit with multiple arguments", async () => {
  const emitter = new TestEventEmitter();
  let receivedA = "";
  let receivedB = 0;
  let receivedC = false;

  emitter.on({
    multi: (a: string, b: number, c: boolean) => {
      receivedA = a;
      receivedB = b;
      receivedC = c;
    },
  });

  await emitter.emit("multi", "test", 456, true);

  assertEquals(receivedA, "test");
  assertEquals(receivedB, 456);
  assertEquals(receivedC, true);
});

Deno.test("EventEmitter - off removes specific handler object with multiple events", async () => {
  const emitter = new TestEventEmitter();
  let messageCount = 0;
  let numberCount = 0;
  let remainingMessageCount = 0;

  // Handler object with multiple events that we'll remove
  const handlersToRemove = {
    message: () => {
      messageCount++;
    },
    count: () => {
      numberCount++;
    },
  };

  // Another handler for message events that should remain
  const remainingHandlers = {
    message: () => {
      remainingMessageCount++;
    },
  };

  emitter.on(handlersToRemove);
  emitter.on(remainingHandlers);

  // Test that both handlers work initially
  await emitter.emit("message", "test1");
  await emitter.emit("count", 42);
  assertEquals(messageCount, 1);
  assertEquals(numberCount, 1);
  assertEquals(remainingMessageCount, 1);

  // Remove the first handler object
  emitter.off(handlersToRemove);

  // Test that only the remaining message handler works
  await emitter.emit("message", "test2");
  await emitter.emit("count", 43);
  assertEquals(messageCount, 1); // Should not have incremented
  assertEquals(numberCount, 1); // Should not have incremented
  assertEquals(remainingMessageCount, 2); // Should have incremented
});

Deno.test("EventEmitter - off removes only the specified handler object", async () => {
  const emitter = new TestEventEmitter();
  let handler1MessageCount = 0;
  let handler1CountValue = 0;
  let handler2MessageCount = 0;
  let handler2CountValue = 0;

  const handlers1 = {
    message: () => {
      handler1MessageCount++;
    },
    count: (num: number) => {
      handler1CountValue = num;
    },
  };

  const handlers2 = {
    message: () => {
      handler2MessageCount++;
    },
    count: (num: number) => {
      handler2CountValue = num;
    },
  };

  emitter.on(handlers1);
  emitter.on(handlers2);

  // Test both handlers work initially
  await emitter.emit("message", "test1");
  await emitter.emit("count", 100);
  assertEquals(handler1MessageCount, 1);
  assertEquals(handler1CountValue, 100);
  assertEquals(handler2MessageCount, 1);
  assertEquals(handler2CountValue, 100);

  // Remove only handlers1
  emitter.off(handlers1);

  // Test that only handlers2 continues to work
  await emitter.emit("message", "test2");
  await emitter.emit("count", 200);
  assertEquals(handler1MessageCount, 1); // Should not have incremented
  assertEquals(handler1CountValue, 100); // Should not have changed
  assertEquals(handler2MessageCount, 2); // Should have incremented
  assertEquals(handler2CountValue, 200); // Should have changed
});

Deno.test("EventEmitter - no handlers for event", async () => {
  const emitter = new TestEventEmitter();

  // Should not throw when emitting to non-existent handlers
  await emitter.emit("message", "test");
  await emitter.emit("count", 42);

  // Test passes if no exception is thrown
  assert(true);
});
