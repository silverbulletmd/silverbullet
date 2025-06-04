import { assert, assertEquals, assertExists } from "@std/assert";
import { HttpServer, type ServerOptions } from "./http_server.ts";
import { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { sleep } from "../lib/async.ts";
import {
  ShellStreamClient,
  type ShellStreamEvent,
} from "../web/shell_stream_client.ts";
import { HttpSpacePrimitives } from "../web/spaces/http_space_primitives.ts";

// Create a test script
async function createTestScript(dir: string): Promise<string> {
  const scriptContent = `#!/bin/sh
echo "Hello from test script"
echo "This is stderr output" >&2
read input
echo "You said: $input"
exit 0
`;

  const scriptPath = `${dir}/test_script.sh`;
  await Deno.writeTextFile(scriptPath, scriptContent);
  await Deno.chmod(scriptPath, 0o755); // Make executable
  return scriptPath;
}

// Create a signal-handling test script
async function createSignalTestScript(dir: string): Promise<string> {
  const scriptContent = `#!/bin/sh
echo "Starting signal test script"
# Set up signal handler
trap 'echo "Received SIGTERM"; exit 0' TERM
trap 'echo "Received SIGINT"; exit 0' INT
echo "Signal handlers set up"
# Wait indefinitely
while true; do
  sleep 1
done
`;

  const scriptPath = `${dir}/signal_test.sh`;
  await Deno.writeTextFile(scriptPath, scriptContent);
  await Deno.chmod(scriptPath, 0o755); // Make executable
  return scriptPath;
}

// Create a long-running test script that writes to a file when it exits
async function createLongRunningScript(dir: string): Promise<string> {
  const scriptContent = `#!/bin/sh
echo "Starting long-running script"
# Create a file to track the process ID
echo $$ > "${dir}/process.pid"
# Set up signal handler to detect proper cleanup
trap 'echo "Process terminated properly" > "${dir}/cleanup.log"; exit 0' TERM INT
echo "Ready for long-running operation"
# Wait indefinitely
while true; do
  sleep 1
  echo "Still running..."
done
`;

  const scriptPath = `${dir}/long_running.sh`;
  await Deno.writeTextFile(scriptPath, scriptContent);
  await Deno.chmod(scriptPath, 0o755); // Make executable
  return scriptPath;
}

// Setup a minimal HttpServer for testing
async function setupTestServer(
  tempDir: string,
): Promise<{ server: HttpServer; port: number }> {
  // Create minimal asset bundles
  const clientAssetBundle = new AssetBundle();
  const plugAssetBundle = new AssetBundle();

  // Create a memory KV store
  const kvPrimitives = new MemoryKvPrimitives();

  // Find an available port
  const port = 9000 + Math.floor(Math.random() * 1000);

  // Create server options
  const options: ServerOptions = {
    hostname: "localhost",
    port,
    clientAssetBundle,
    plugAssetBundle,
    baseKvPrimitives: kvPrimitives,
    pagesPath: tempDir,
    shellBackend: "local", // Use local shell backend
    readOnly: false,
    indexPage: "index",
    enableSpaceScript: false,
  };

  // Create and start the server
  const server = new HttpServer(options);
  await server.start();

  return { server, port };
}

// Helper function to create a script that fails with an error
async function createErrorScript(dir: string): Promise<string> {
  const scriptContent = `#!/bin/sh
echo "This is stdout before the error"
echo "This is stderr output" >&2
exit 1
`;

  const scriptPath = `${dir}/error_script.sh`;
  await Deno.writeTextFile(scriptPath, scriptContent);
  await Deno.chmod(scriptPath, 0o755); // Make executable
  return scriptPath;
}

// Run all tests in a single test function to avoid resource tracking issues
// TODO: Fix this, make this more stable
Deno.test("Shell endpoint tests", { ignore: true }, async () => {
  // Test 1: Basic functionality with POST endpoint
  {
    // Test: Basic functionality with POST endpoint
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create a client with HttpSpacePrimitives
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );
        const client = new ShellStreamClient({
          httpSpacePrimitives,
          cmd: "echo",
          args: ["Hello, World!"],
        });

        // Collect events
        const events: ShellStreamEvent[] = [];
        client.addEventListener("stdout", (event) => events.push(event));
        client.addEventListener("stderr", (event) => events.push(event));
        client.addEventListener("exit", (event) => events.push(event));

        // Connect to the server
        await client.start();

        // Wait for output and exit
        await sleep(1000);

        // Close the connection and wait for cleanup
        client.close();
        await sleep(500);

        // Verify events
        assert(events.length >= 1, "Expected at least 1 event");

        // Should have stdout message
        const stdoutEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("Hello, World!")
        );
        assertExists(stdoutEvent, "Stdout event not found");
      } finally {
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  // Cleanup on premature WebSocket close
  {
    // Test: Cleanup on premature WebSocket close
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Create a long-running test script
      const scriptPath = await createLongRunningScript(tempDir);

      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create a client with HttpSpacePrimitives
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );
        const client = new ShellStreamClient({
          httpSpacePrimitives,
          cmd: scriptPath,
          args: [],
        });

        // Collect events
        const events: ShellStreamEvent[] = [];
        client.addEventListener("stdout", (event) => events.push(event));
        client.addEventListener("stderr", (event) => events.push(event));
        client.addEventListener("exit", (event) => events.push(event));

        // Connect to the server
        await client.start();

        // Wait for the script to start
        await sleep(1000);

        // Verify the process is running by checking if the PID file exists
        const pidFileExists = await Deno.stat(`${tempDir}/process.pid`)
          .then(
            () => true,
            () => false,
          );
        assert(pidFileExists, "Process PID file should exist");

        // Close the WebSocket connection prematurely
        client.close();

        // Wait for cleanup to happen
        await sleep(2000);

        // Check if the cleanup log file was created, indicating proper termination
        const cleanupFileExists = await Deno.stat(`${tempDir}/cleanup.log`)
          .then(
            () => true,
            () => false,
          );
        assert(
          cleanupFileExists,
          "Cleanup log file should exist, indicating proper process termination",
        );

        if (cleanupFileExists) {
          const cleanupContent = await Deno.readTextFile(
            `${tempDir}/cleanup.log`,
          );
          assert(
            cleanupContent.includes("Process terminated properly"),
            "Process should have been terminated properly",
          );
        }

        // Verify events
        const startupEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("Starting long-running script")
        );
        assertExists(startupEvent, "Startup message not found");
      } finally {
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  // Unified send method with POST endpoint
  {
    // Test: Unified send method with POST endpoint
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Create a test script
      const scriptPath = await createTestScript(tempDir);

      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create a client with HttpSpacePrimitives
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );
        const client = new ShellStreamClient({
          httpSpacePrimitives,
          cmd: scriptPath,
          args: [],
        });

        // Collect events
        const events: ShellStreamEvent[] = [];
        client.addEventListener("stdout", (event) => events.push(event));
        client.addEventListener("stderr", (event) => events.push(event));
        client.addEventListener("exit", (event) => events.push(event));

        // Connect to the server
        await client.start();

        // Wait for initial output
        await sleep(500);

        // Send input using the unified send() method
        client.send("Hello from test");

        // Wait for response and exit
        await sleep(1000);

        // Close the connection and wait for cleanup
        client.close();
        await sleep(500);

        // Verify events
        assert(events.length >= 3, "Expected at least 3 events");

        // Should have stdout message
        const stdoutEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("Hello from test script")
        );
        assertExists(stdoutEvent, "Stdout event not found");

        // Should have stderr message
        const stderrEvent = events.find((e) =>
          e.type === "stderr" &&
          typeof e.data === "string" &&
          e.data.includes("This is stderr output")
        );
        assertExists(stderrEvent, "Stderr event not found");

        // Should have response to input
        const responseEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("You said: Hello from test")
        );
        assertExists(responseEvent, "Response event not found");
      } finally {
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  // Send signal to process
  {
    // Test: Send signal to process
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Create a signal-handling test script
      const scriptPath = await createSignalTestScript(tempDir);

      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create a client with HttpSpacePrimitives
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );
        const client = new ShellStreamClient({
          httpSpacePrimitives,
          cmd: scriptPath,
          args: [],
        });

        // Collect events
        const events: ShellStreamEvent[] = [];
        client.addEventListener("stdout", (event) => events.push(event));
        client.addEventListener("stderr", (event) => events.push(event));
        client.addEventListener("exit", (event) => events.push(event));

        // Connect to the server
        await client.start();

        // Wait for the script to start and set up signal handlers
        await sleep(1000);

        // Send a signal to the process
        client.kill("SIGTERM");

        // Wait for the process to handle the signal and exit
        await sleep(1000);

        // Close the connection and wait for cleanup
        client.close();
        await sleep(500);

        // Verify events
        assert(events.length >= 3, "Expected at least 3 events");

        // Should have initial stdout messages
        const startupEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("Starting signal test script")
        );
        assertExists(startupEvent, "Startup message not found");

        // Should have signal handler message
        const signalEvent = events.find((e) =>
          e.type === "stdout" &&
          typeof e.data === "string" &&
          e.data.includes("Received SIGTERM")
        );
        assertExists(signalEvent, "Signal handler message not found");

        // Should have exit event
        const exitEvent = events.find((e) => e.type === "exit");
        assertExists(exitEvent, "Exit event not found");
      } finally {
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }
  // .shell command with arguments
  {
    // Test: Command with arguments
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Create a test script
      const scriptPath = await createTestScript(tempDir);

      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create HTTP space primitives for making requests
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );

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
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  // Error handling
  {
    // Test: Error handling
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Create an error script
      const scriptPath = await createErrorScript(tempDir);

      // Set up test server
      const { server, port } = await setupTestServer(tempDir);

      try {
        // Create HTTP space primitives for making requests
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );

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
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  // Read-only mode
  {
    // Test: Read-only mode
    // Create a temporary directory for testing
    const tempDir = await Deno.makeTempDir();

    try {
      // Set up test server with read-only mode
      const { server, port } = await setupTestServer(tempDir);

      // Set server to read-only mode
      server.spaceServer.readOnly = true;

      try {
        // Create HTTP space primitives for making requests
        const httpSpacePrimitives = new HttpSpacePrimitives(
          `http://localhost:${port}`,
        );

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
        // Clean up server
        server.stop();
      }
    } finally {
      // Clean up temporary directory
      await Deno.remove(tempDir, { recursive: true });
    }
  }
});
