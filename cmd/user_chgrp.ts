import { JSONKVStore } from "../plugos/lib/kv_store.json_file.ts";
import { Authenticator } from "../server/auth.ts";

export async function userChgrp(
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

  console.log("Setting groups for user:", options.group);

  const store = new JSONKVStore();
  try {
    await store.load(authFile);
  } catch (e: any) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("Creating new auth database because it didn't exist.");
    }
  }
  const auth = new Authenticator(store);
  await auth.setGroups(username!, options.group);
  await store.save(authFile);
}
