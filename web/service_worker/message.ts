import { simpleHash } from "../../lib/crypto.ts";
import { DataStore } from "../../lib/data/datastore.ts";
import { IndexedDBKvPrimitives } from "../../lib/data/indexeddb_kv_primitives.ts";
import { fsEndpoint } from "../../lib/spaces/constants.ts";
import { DataStoreSpacePrimitives } from "../../lib/spaces/datastore_space_primitives.ts";
import { HttpSpacePrimitives } from "../../lib/spaces/http_space_primitives.ts";
import { SyncEngine } from "./sync.ts";

export class MessageHandler {
  ds: DataStore | undefined;

  constructor(
    self: any,
    baseURI: string,
    basePathName: string,
    configureCallback: (engine: SyncEngine) => void,
  ) {
    self.addEventListener("message", (event: any) => {
      switch (event.data.type) {
        case "skipWaiting": {
          // @ts-ignore: Skip waiting to activate this service worker immediately
          self.skipWaiting();
          break;
        }
        case "config": {
          const config = event.data.config;
          const spaceFolderPath = config.spaceFolderPath;
          const dbPrefix = "" +
            simpleHash(`${spaceFolderPath}:${baseURI.replace(/\/*$/, "")}`);

          // Setup space
          const kv = new IndexedDBKvPrimitives(dbPrefix);
          kv.init().then(() => {
            const ds = new DataStore(kv);
            console.log("Datastore in service worker initialized...");
            const remote = new HttpSpacePrimitives(
              basePathName + fsEndpoint,
              spaceFolderPath,
              (message, actionOrRedirectHeader) => {
                console.error(
                  "[service proxy error]",
                  message,
                  actionOrRedirectHeader,
                );
                // if (actionOrRedirectHeader === "reload") {
                //   location.reload();
                // } else {
                //   location.href = actionOrRedirectHeader;
                // }
              },
            );
            const local = new DataStoreSpacePrimitives(ds);
            const engine = new SyncEngine(ds, local, remote);
            engine.start();
            configureCallback(engine);
          });
          break;
        }
      }
    });
  }
}
