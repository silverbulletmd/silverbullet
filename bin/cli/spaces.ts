import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readConfig, writeConfig, encrypt, type SpaceConfig } from "./config.ts";
import { SpaceConnection } from "./api.ts";

export async function spaceAdd(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const config = await readConfig();

    // Name
    const name = await rl.question("Space name: ");
    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
      console.error(
        "Error: name must be alphanumeric with hyphens only",
      );
      process.exit(1);
    }
    if (config.spaces.some((s) => s.name === name)) {
      console.error(`Error: space "${name}" already exists`);
      process.exit(1);
    }

    // URL
    const url = await rl.question("URL (e.g. http://localhost:3000): ");
    try {
      new URL(url);
    } catch {
      console.error("Error: invalid URL format");
      process.exit(1);
    }

    // Ping check
    const reachable = await new SpaceConnection({ url }).ping();
    if (!reachable) {
      console.warn("Warning: could not reach server at that URL (saving anyway)");
    }

    // Auth type
    const authTypeInput = await rl.question(
      "Auth type (token / password / none) [none]: ",
    );
    const authType = (authTypeInput.trim() || "none") as SpaceConfig["authType"];
    if (!["token", "password", "none"].includes(authType)) {
      console.error("Error: auth type must be token, password, or none");
      process.exit(1);
    }

    const space: SpaceConfig = { name, url: url.replace(/\/$/, ""), authType };

    if (authType === "token") {
      const token = await rl.question("Token: ");
      space.encryptedToken = encrypt(token);
    } else if (authType === "password") {
      space.username = await rl.question("Username: ");
      const password = await rl.question("Password: ");
      space.encryptedPassword = encrypt(password);
    }

    config.spaces.push(space);
    await writeConfig(config);
    console.log(`Space "${name}" added.`);
  } finally {
    rl.close();
  }
}

export async function spaceList(): Promise<void> {
  const config = await readConfig();
  if (config.spaces.length === 0) {
    console.log("No spaces configured. Use 'space add' to add one.");
    return;
  }

  console.log("");
  console.log(
    `${"NAME".padEnd(20)}${"URL".padEnd(40)}AUTH`,
  );
  console.log("-".repeat(70));
  for (const s of config.spaces) {
    console.log(
      s.name.padEnd(20) + s.url.padEnd(40) + s.authType,
    );
  }
  console.log("");
}

export async function spaceRemove(name: string): Promise<void> {
  const config = await readConfig();
  const idx = config.spaces.findIndex((s) => s.name === name);
  if (idx === -1) {
    console.error(`Error: space "${name}" not found`);
    process.exit(1);
  }
  config.spaces.splice(idx, 1);
  await writeConfig(config);
  console.log(`Space "${name}" removed.`);
}
