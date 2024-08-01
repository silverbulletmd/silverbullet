import { assertEquals } from "@std/assert";
import { parseYamlSettings } from "./settings.ts";

Deno.test("Settings regex", () => {
  const exampleSettings = {
    foo: "bar",
    żółć: "🟡", // make sure Unicode works
  };

  assertEquals(
    parseYamlSettings(`
The typical case would be like this

\`\`\`yaml
foo: bar
żółć: 🟡
\`\`\`
`),
    exampleSettings,
  );

  assertEquals(
    parseYamlSettings(`
Tilde delimiters or space-config should also work

~~~space-config
foo: bar
żółć: 🟡
~~~
`),
    exampleSettings,
  );

  assertEquals(
    parseYamlSettings(`
\`\`\`yaml-settings
wrong info string
\`\`\`

~~~yaml
missing an end
~~
`),
    {},
  );

  assertEquals(
    parseYamlSettings(`
The little known feature of longer delimiters
\`\`\`\`\`yaml
complexText: |
  \`\`\`yaml
  ~~~
  \`\`\`\`
foo: bar
żółć: 🟡
\`\`\`\`\`
`),
    { ...exampleSettings, complexText: "```yaml\n~~~\n````\n" },
  );
});
