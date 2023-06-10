import { Hocuspocus } from "../server/deps.ts";
import { Database } from "npm:@hocuspocus/extension-database@2.0.6";

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function collabServerCommand(
  options: any,
  dataDir = ".",
) {
  const port = options.port || 1337;
  // Make sure the data directory exists
  Deno.mkdirSync(dataDir, { recursive: true });
  const hocuspocus = new Hocuspocus({
    port: port,
    // address: "127.0.0.1",
    quiet: true,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          console.log("Loading", documentName, "from disk.");
          try {
            const data = await Deno.readFile(
              `${dataDir}/${safeFilename(documentName)}`,
            );
            return data;
          } catch (e: any) {
            console.error("Error loading document", e.message);
            return null;
          }
        },
        store: async ({ documentName, state }) => {
          console.log("Persisting", documentName, "to disk.");
          try {
            await Deno.writeFile(
              `${dataDir}/${safeFilename(documentName)}`,
              state,
            );
          } catch (e: any) {
            console.error("Error storing document", e.message);
          }
        },
      }),
    ],
  });

  hocuspocus.listen(() => {
    console.log(`Collab server now listening on port ${port}`);
    return Promise.resolve();
  });
}
