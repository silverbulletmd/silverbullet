import { expect, test } from "vitest";
import { initLogger, Logger } from "./logger.ts";

test("Logger prefix functionality", () => {
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

    expect(capturedOutput[0]).toEqual("[TEST] Hello world");
    expect(capturedOutput[1]).toEqual("[TEST] Info message");
    expect(capturedOutput[2]).toEqual("[TEST] Warning message");
    expect(capturedOutput[3]).toEqual("[TEST] Error message");
  } finally {
    // Restore original console methods
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("Logger without prefix", () => {
  const originalLog = console.log;
  const capturedOutput: string[] = [];

  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  try {
    new Logger("");

    console.log("Hello", "world");

    expect(capturedOutput[0]).toEqual("Hello world");
  } finally {
    console.log = originalLog;
  }
});

test("Logger log capture", () => {
  const logger = new Logger("[CAPTURE]");

  console.log("First message");
  console.info("Second message", { key: "value" });
  console.warn("Third message", 123);
  console.error("Fourth message");

  const capturedLogs = logger.logBuffer;

  expect(capturedLogs.length).toEqual(4);

  expect(capturedLogs[0].level).toEqual("log");
  expect(capturedLogs[0].message).toEqual("First message");

  expect(capturedLogs[1].level).toEqual("info");
  expect(capturedLogs[1].message).toEqual('Second message {"key":"value"}');

  expect(capturedLogs[2].level).toEqual("warn");
  expect(capturedLogs[2].message).toEqual("Third message 123");

  expect(capturedLogs[3].level).toEqual("error");
  expect(capturedLogs[3].message).toEqual("Fourth message");

  // Check that all entries have timestamps
  capturedLogs.forEach((entry) => {
    expect(typeof entry.timestamp === "number").toBeTruthy();
    expect(entry.timestamp > 0).toBeTruthy();
  });
});

test("Logger max capture size", () => {
  const logger = new Logger("[SIZE]", 3);

  // Add more logs than the max size
  console.log("Message 1");
  console.log("Message 2");
  console.log("Message 3");
  console.log("Message 4");
  console.log("Message 5");

  const capturedLogs = logger.logBuffer;

  // Should only keep the last 3 messages
  expect(capturedLogs.length).toEqual(3);
  expect(capturedLogs[0].message).toEqual("Message 3");
  expect(capturedLogs[1].message).toEqual("Message 4");
  expect(capturedLogs[2].message).toEqual("Message 5");
});

test("Global logger initialization", () => {
  const originalLog = console.log;
  const capturedOutput: string[] = [];

  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  try {
    const logger = initLogger("[GLOBAL]");

    console.log("Global test");

    expect(capturedOutput[0]).toEqual("[GLOBAL] Global test");
    expect(logger instanceof Logger).toBeTruthy();
  } finally {
    console.log = originalLog;
  }
});

test("Logger handles complex objects", () => {
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

  expect(capturedLogs.length).toEqual(2);

  // First log should handle complex object properly
  expect(capturedLogs[0].message).toEqual(`Complex object: {"name":"test","nested":{"value":42},"array":[1,2,3]}`,
  );

  // Second log should handle circular reference gracefully
  expect(capturedLogs[1].message).toEqual(`Circular object: [object Object]`);
});
