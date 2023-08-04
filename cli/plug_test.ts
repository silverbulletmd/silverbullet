import { index } from "$sb/silverbullet-syscall/mod.ts";

export async function run() {
  console.log("Hello from plug_test.ts");
  console.log(await index.queryPrefix(`tag:`));
  return "Hello";
}
