import { store } from "$sb/syscalls.ts";

export async function run() {
  console.log("Hello from plug_test.ts");
  await store.set("plug_test", "Hello");
  return "Hello";
}
