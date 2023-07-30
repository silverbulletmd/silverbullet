import { readSetting } from "$sb/lib/settings_page.ts";

type FederationConfig = {
  uri: string;
  perm?: "ro" | "rw";
  // TODO: alias?: string;
};

let federationConfigs: FederationConfig[] = [];
let lastFederationUrlFetch = 0;

export async function readFederationConfigs(): Promise<FederationConfig[]> {
  // Update at most every 5 seconds
  if (Date.now() > lastFederationUrlFetch + 5000) {
    federationConfigs = await readSetting("federate", []);
    if (!Array.isArray(federationConfigs)) {
      console.error("'federate' setting should be an array of objects");
      return [];
    }
    // Normalize URIs
    for (const config of federationConfigs) {
      if (!config.uri) {
        console.error(
          "'federate' setting should be an array of objects with at least an 'uri' property",
          config,
        );
        continue;
      }
      if (!config.uri.startsWith("!")) {
        config.uri = `!${config.uri}`;
      }
    }
    lastFederationUrlFetch = Date.now();
  }
  return federationConfigs;
}
