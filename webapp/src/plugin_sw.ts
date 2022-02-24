import { Manifest } from "./plugins/types";

import { openDB, wrap, unwrap } from "idb";

const rootUrl = location.origin + "/plugin";

// Storing manifests in IndexedDB, y'all
let manifestCache = caches.open("manifests");

const db = openDB("manifests-store", undefined, {
  upgrade(db) {
    db.createObjectStore("manifests");
  },
});

async function saveManifest(name: string, manifest: Manifest) {
  await (await db).put("manifests", manifest, name);
}

async function getManifest(name: string): Promise<Manifest | undefined> {
  return (await (await db).get("manifests", name)) as Manifest | undefined;
}

self.addEventListener("install", (event) => {
  console.log("Installing");
  // @ts-ignore
  self.skipWaiting();
  // event.waitUntil(fetchBundle());
});

async function handlePut(req: Request, path: string) {
  console.log("Got manifest load for", path);
  let manifest = (await req.json()) as Manifest;
  await saveManifest(path, manifest);
  // loadedBundles.set(path, manifest);
  return new Response("ok");
}

self.addEventListener("fetch", (event: any) => {
  const req = event.request;
  if (req.url.startsWith(rootUrl)) {
    let path = req.url.substring(rootUrl.length + 1);
    event.respondWith(
      (async () => {
        // console.log("Service worker is serving", path);
        if (path === `$ping`) {
          // console.log("Got ping");
          return new Response("ok");
        }

        if (req.method === "PUT") {
          return await handlePut(req, path);
        }

        let [cartridgeName, resourceType, functionName] = path.split("/");

        let manifest = await getManifest(cartridgeName);

        if (!manifest) {
          // console.log("Ain't got", cartridgeName);
          return new Response(`Cartridge not loaded: ${cartridgeName}`, {
            status: 404,
          });
        }

        if (resourceType === "$manifest") {
          return new Response(JSON.stringify(manifest));
        }

        if (resourceType === "function") {
          let func = manifest.functions[functionName];
          // console.log("Serving function", functionName, func);
          if (!func) {
            return new Response("Not found", {
              status: 404,
            });
          }
          return new Response(func.code, {
            status: 200,
            headers: {
              "Content-type": "application/javascript",
            },
          });
        }
      })()
    );
  }
});

self.addEventListener("activate", (event) => {
  // console.log("Now ready to pick up fetches");
  // @ts-ignore
  event.waitUntil(self.clients.claim());
});

// console.log("I'm a service worker, look at me!", location.href);
