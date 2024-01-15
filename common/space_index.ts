import { DataStore } from "../plugos/lib/datastore.ts";
import { System } from "../plugos/system.ts";

const indexVersionKey = ["$indexVersion"];

// Bump this one every time a full reinxex is needed
const desiredIndexVersion = 3;

let indexOngoing = false;

export async function ensureSpaceIndex(ds: DataStore, system: System<any>) {
  const currentIndexVersion = await ds.get(indexVersionKey);

  console.info("Current space index version", currentIndexVersion);

  if (currentIndexVersion !== desiredIndexVersion && !indexOngoing) {
    console.info("Performing a full space reindex, this could take a while...");
    indexOngoing = true;
    await system.loadedPlugs.get("index")!.invoke("reindexSpace", []);
    console.info("Full space index complete.");
    await markFullSpaceIndexComplete(ds);
    indexOngoing = false;
  } else {
    console.info("Space index is up to date");
  }
}

export async function markFullSpaceIndexComplete(ds: DataStore) {
  await ds.set(indexVersionKey, desiredIndexVersion);
}
