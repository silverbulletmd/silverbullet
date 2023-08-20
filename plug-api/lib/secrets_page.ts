import { readYamlPage } from "./yaml_page.ts";

// Read SECRETS page and retrieve specific set of secret keys
// Note: in this implementation there's no encryption employed at all so it's just a matter
// of not decising this SECRETS page to other places
export async function readSecrets(keys: string[]): Promise<any[]> {
  try {
    const allSecrets = await readYamlPage("SECRETS", ["yaml", "secrets"]);
    const collectedSecrets: any[] = [];
    for (const key of keys) {
      const secret = allSecrets[key];
      if (secret) {
        collectedSecrets.push(secret);
      } else {
        throw new Error(`No such secret: ${key}`);
      }
    }
    return collectedSecrets;
  } catch (e: any) {
    if (e.message === "Not found") {
      throw new Error(`No such secret: ${keys[0]}`);
    }
    throw e;
  }
}

// Read SECRETS page and retrieve a specific secret
export async function readSecret(key: string): Promise<any> {
  try {
    const allSecrets = await readYamlPage("SECRETS", ["yaml", "secrets"]);
    const val = allSecrets[key];
    if (val === undefined) {
      throw new Error(`No such secret: ${key}`);
    }
    return val;
  } catch (e: any) {
    if (e.message === "Not found") {
      throw new Error(`No such secret: ${key}`);
    }
    throw e;
  }
}
