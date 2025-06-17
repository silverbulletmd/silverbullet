import { assert, assertEquals } from "@std/assert";
import { HttpServer, type ServerOptions } from "./http_server.ts";
import { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { MemoryKvPrimitives } from "../lib/data/memory_kv_primitives.ts";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";

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
    pagesPath: tempDir,
    shellBackend: "local", // Use local shell backend
    readOnly: false,
    indexPage: "index",
    hostUrlPrefix: undefined,
  };

  // Create and start the server
  const server = new HttpServer(
    options,
    clientAssetBundle,
    plugAssetBundle,
    kvPrimitives,
  );
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
Deno.test("Shell endpoint tests", async () => {
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
      server.options.readOnly = true;

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
