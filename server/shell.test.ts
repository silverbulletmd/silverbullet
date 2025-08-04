import { assert, assertEquals } from "@std/assert";
import { TestServerManager } from "./test_server_manager.ts";

// Run all tests in a single test function to avoid resource tracking issues
Deno.test("Shell endpoint tests", async () => {
  // .shell command with arguments
  {
    // Test: Command with arguments
    const testServer = new TestServerManager();

    try {
      await testServer.start();

      // Create a test script
      const scriptPath = await testServer.createTestScript(`#!/bin/sh
echo "Hello from test script"
echo "This is stderr output" >&2
read input
echo "You said: $input"
exit 0
`);

      const httpSpacePrimitives = testServer.getHttpSpacePrimitives();

      // Test command with arguments
      const response = await httpSpacePrimitives.authenticatedFetch(
        `${httpSpacePrimitives.url}/.shell`,
        {
          method: "POST",
          body: JSON.stringify({
            cmd: scriptPath,
            args: [],
          }),
        },
      );

      // Check if response is successful and contains JSON
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shell request failed with status ${response.status}: ${text}`);
      }

      const result = await response.json();

      // Verify response
      assertEquals(result.code, 0, "Exit code should be 0");
      assert(
        result.stdout.includes("Hello from test script"),
        "Output should contain the script output",
      );
      assert(
        result.stderr.includes("This is stderr output"),
        "Stderr should contain the error output",
      );
    } finally {
      await testServer.stop();
    }
  }

  // Error handling
  {
    // Test: Error handling
    const testServer = new TestServerManager();

    try {
      await testServer.start();

      // Create an error script
      const scriptPath = await testServer.createTestScript(`#!/bin/sh
echo "This is stdout before the error"
echo "This is stderr output" >&2
exit 1
`, "error_script.sh");

      const httpSpacePrimitives = testServer.getHttpSpacePrimitives();

      // Test command that fails
      const response = await httpSpacePrimitives.authenticatedFetch(
        `${httpSpacePrimitives.url}/.shell`,
        {
          method: "POST",
          body: JSON.stringify({
            cmd: scriptPath,
            args: [],
          }),
        },
      );

      // Check if response is successful and contains JSON
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shell request failed with status ${response.status}: ${text}`);
      }

      const result = await response.json();

      // Verify response
      assertEquals(result.code, 1, "Exit code should be 1");
      assert(
        result.stdout.includes("This is stdout before the error"),
        "Output should contain the stdout text",
      );
      assert(
        result.stderr.includes("This is stderr output"),
        "Stderr should contain the error output",
      );
    } finally {
      await testServer.stop();
    }
  }

  // Read-only mode
  {
    // Test: Read-only mode
    const testServer = new TestServerManager();

    try {
      await testServer.start({ readOnly: true });

      const httpSpacePrimitives = testServer.getHttpSpacePrimitives();

      // Test command in read-only mode
      const response = await httpSpacePrimitives.authenticatedFetch(
        `${httpSpacePrimitives.url}/.shell`,
        {
          method: "POST",
          body: JSON.stringify({
            cmd: "echo",
            args: ["Hello, World!"],
          }),
        },
      );

      // Verify response status is 405 Method Not Allowed
      assertEquals(
        response.status,
        405,
        "Status should be 405 Method Not Allowed",
      );

      const text = await response.text();
      assert(
        text.includes("Read only mode"),
        "Response should mention read-only mode",
      );
    } finally {
      await testServer.stop();
    }
  }
});
