import { ScriptEnvironment } from "./space_script.ts";

Deno.test("Space script", async () => {
  const env = new ScriptEnvironment();
  env.evalScript(
    `
silverbullet.registerFunction("add", (a, b) => a + b);
    `,
    undefined as any,
  );
  console.log("Env", env);
});
