import { assertEquals } from "@std/assert";
import { parseYamlConfig } from "./config.ts";

Deno.test("Config regex", () => {
  const exampleConfig = {
    foo: "bar",
    żółć: "🟡", // make sure Unicode works
  };

  assertEquals(
    parseYamlConfig(`
The typical case would be like this

\`\`\`yaml
foo: bar
żółć: 🟡
\`\`\`
`),
    exampleConfig,
  );

  assertEquals(
    parseYamlConfig(`
Tilde delimiters or space-config should also work

~~~space-config
foo: bar
żółć: 🟡
~~~
`),
    exampleConfig,
  );

  assertEquals(
    parseYamlConfig(`
\`\`\`yaml-config
wrong info string
\`\`\`

~~~yaml
missing an end
~~
`),
    {},
  );

  assertEquals(
    parseYamlConfig(`
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
    { ...exampleConfig, complexText: "```yaml\n~~~\n````\n" },
  );
});
