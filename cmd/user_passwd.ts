import getpass from "https://deno.land/x/getpass@0.3.1/mod.ts";
import { JSONKVStore } from "../plugos/lib/kv_store.json_file.ts";
import { Authenticator } from "../server/auth.ts";

export async function userPasswd(
  options: any,
  username?: string,
) {
  const authFile = options.auth || ".auth.json";
  console.log("Using auth file", authFile);
  if (!username) {
    username = prompt("Username:")!;
  }
  if (!username) {
    return;
  }

  const store = new JSONKVStore();
  try {
    await store.load(authFile);
  } catch (e: any) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("Creating new auth database because it didn't exist.");
    }
  }
  const auth = new Authenticator(store);

  const user = await auth.getUser(username);

  if (!user) {
    console.error("User", username, "not found.");
    Deno.exit(1);
  }

  const pw = getpass("New password: ");
  if (!pw) {
    return;
  }

  await auth.setPassword(username!, pw!);
  await store.save(authFile);
}
