// Generate available import symbols
// from vfs.js file

import env from "../vfs.js";

let symbols = "";
for (const symbol of Object.keys(env().env)) {
  symbols += `${symbol}\n`;
}
await Deno.writeFile(Deno.args[0], new TextEncoder().encode(symbols));
