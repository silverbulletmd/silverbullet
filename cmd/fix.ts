import { path } from "../server/deps.ts";

export async function fixCommand(_options: any, folder: string) {
  folder = path.resolve(Deno.cwd(), folder);
  console.log("Now going to attempt to fix", folder);
  console.log(`First, we'll purge the ${folder}/_plug folder...`);
  try {
    await Deno.remove(path.join(folder, "_plug"), { recursive: true });
  } catch (e: any) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("No _plug folder found, nothing to do here.");
    } else {
      console.error("Something went wrong:", e);
    }
  }
  console.log("And now we'll delete data.db");
  try {
    await Deno.remove(path.join(folder, "data.db"));
  } catch (e: any) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("No data.db found, nothing to do here.");
    } else {
      console.error("Something went wrong:", e);
    }
  }
  console.log(
    "Alright then, that should be it. Try running Silver Bullet again.",
  );
}
