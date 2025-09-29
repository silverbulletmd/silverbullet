import { assert, assertEquals } from "@std/assert";
import { initLogger, Logger } from "./logger.ts";

Deno.test("Logger prefix functionality", () => {
  // Store original console methods
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  const capturedOutput: string[] = [];

  // Mock console methods to capture output
  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };
  console.info = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };
  console.warn = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };
  console.error = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  try {
    new Logger("[TEST]");

    console.log("Hello", "world");
    console.info("Info message");
    console.warn("Warning message");
    console.error("Error message");

    assertEquals(capturedOutput[0], "[TEST] Hello world");
    assertEquals(capturedOutput[1], "[TEST] Info message");
    assertEquals(capturedOutput[2], "[TEST] Warning message");
    assertEquals(capturedOutput[3], "[TEST] Error message");
  } finally {
    // Restore original console methods
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

Deno.test("Logger without prefix", () => {
  const originalLog = console.log;
  const capturedOutput: string[] = [];

  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  try {
    new Logger("");

    console.log("Hello", "world");

    assertEquals(capturedOutput[0], "Hello world");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger log capture", () => {
  const logger = new Logger("[CAPTURE]");

  console.log("First message");
  console.info("Second message", { key: "value" });
  console.warn("Third message", 123);
  console.error("Fourth message");

  const capturedLogs = logger.logBuffer;

  assertEquals(capturedLogs.length, 4);

  assertEquals(capturedLogs[0].level, "log");
  assertEquals(capturedLogs[0].message, "First message");

  assertEquals(capturedLogs[1].level, "info");
  assertEquals(capturedLogs[1].message, 'Second message {"key":"value"}');

  assertEquals(capturedLogs[2].level, "warn");
  assertEquals(capturedLogs[2].message, "Third message 123");

  assertEquals(capturedLogs[3].level, "error");
  assertEquals(capturedLogs[3].message, "Fourth message");

  // Check that all entries have timestamps
  capturedLogs.forEach((entry) => {
    assert(typeof entry.timestamp === "number");
    assert(entry.timestamp > 0);
  });
});

Deno.test("Logger max capture size", () => {
  const logger = new Logger("[SIZE]", 3);

  // Add more logs than the max size
  console.log("Message 1");
  console.log("Message 2");
  console.log("Message 3");
  console.log("Message 4");
  console.log("Message 5");

  const capturedLogs = logger.logBuffer;

  // Should only keep the last 3 messages
  assertEquals(capturedLogs.length, 3);
  assertEquals(capturedLogs[0].message, "Message 3");
  assertEquals(capturedLogs[1].message, "Message 4");
  assertEquals(capturedLogs[2].message, "Message 5");
});

Deno.test("Global logger initialization", () => {
  const originalLog = console.log;
  const capturedOutput: string[] = [];

  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  try {
    const logger = initLogger("[GLOBAL]");

    console.log("Global test");

    assertEquals(capturedOutput[0], "[GLOBAL] Global test");
    assert(logger instanceof Logger);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger handles complex objects", () => {
  const logger = new Logger("[COMPLEX]");

  const complexObject = {
    name: "test",
    nested: { value: 42 },
    array: [1, 2, 3],
  };

  const circularObject: any = { name: "circular" };
  circularObject.self = circularObject;

  console.log("Complex object:", complexObject);
  console.log("Circular object:", circularObject);

  const capturedLogs = logger.logBuffer;

  assertEquals(capturedLogs.length, 2);

  // First log should handle complex object properly
  assertEquals(
    capturedLogs[0].message,
    `Complex object: {"name":"test","nested":{"value":42},"array":[1,2,3]}`,
  );

  // Second log should handle circular reference gracefully
  assertEquals(capturedLogs[1].message, `Circular object: [object Object]`);
});
