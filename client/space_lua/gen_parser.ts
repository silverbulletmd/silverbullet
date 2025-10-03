const grammar = "client/space_lua/lua.grammar";
const outfile = "client/space_lua/parse-lua.js";

const cmd = new Deno.Command("node_modules/.bin/lezer-generator", {
  args: [
    grammar,
    "--output", outfile
  ],
  stdfile: "inherit",
  stderr: "inherit",
});

const { code } = await cmd.output();
if (code !== 0) {
  throw new Error("lezer-generator failed");
}
