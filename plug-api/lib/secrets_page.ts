import { readYamlPage } from "./yaml_page.ts";

// Read SECRETS page and retrieve specific set of secret keys
// Note: in this implementation there's no encryption employed at all so it's just a matter
// of not decising this SECRETS page to other places
export async function readSecrets(keys: string[]): Promise<any[]> {
  try {
    let allSecrets = await readYamlPage("SECRETS", ["yaml", "secrets"]);
    let collectedSecrets: any[] = [];
    for (let key of keys) {
      let secret = allSecrets[key];
      if (secret) {
        collectedSecrets.push(secret);
      } else {
        throw new Error(`No such secret: ${key}`);
      }
    }
    return collectedSecrets;
  } catch (e: any) {
    if (e.message === "Page not found") {
      throw new Error(`No such secret: ${keys[0]}`);
    }
    throw e;
  }
}
