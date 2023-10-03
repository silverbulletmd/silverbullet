import { datastore } from "$sb/syscalls.ts";

export async function run() {
  console.log("Hello from plug_test.ts");
  await datastore.set(["plug_test"], "Hello");
  return "Hello";
}
