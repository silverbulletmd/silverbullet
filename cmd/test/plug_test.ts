import { datastore } from "@silverbulletmd/silverbullet/syscalls";

export async function run() {
  console.log("Hello from plug_test.ts");
  await datastore.set(["plug_test"], "Hello");
  return "Hello";
}
