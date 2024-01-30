import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";
import { assertEquals } from "../../test_deps.ts";
import { renderTemplate } from "./render.ts";
import { parseTemplate } from "./template_parser.ts";

Deno.test("Test template", async () => {
  const functionMap = builtinFunctions;

  const globalVariables = {
    page: { name: "this page" },
  };

  // Base case
  assertEquals(await parseAndRender(`Hello World`, {}), `Hello World`);

  // Variable
  assertEquals(
    await parseAndRender(`Hello {{name}}`, { name: "World" }),
    `Hello World`,
  );

  // Global variable
  assertEquals(
    await parseAndRender(`Hello {{@page.name}}`, {}),
    `Hello this page`,
  );

  // Function invocation
  assertEquals(
    await parseAndRender(`Hello {{replace(name, "o", "e")}}`, {
      name: "World",
    }),
    `Hello Werld`,
  );

  // Two variables
  assertEquals(
    await parseAndRender(`Hello {{firstName}} {{lastName}}`, {
      firstName: "Pete",
      lastName: "Smith",
    }),
    `Hello Pete Smith`,
  );

  // Each directive
  assertEquals(
    await parseAndRender(
      `a{{#each .}}* {{name}}\n{{/each}}b`,
      [
        { name: "Pete" },
        { name: "John" },
      ],
    ),
    `a* Pete\n* John\nb`,
  );

  // If directive
  assertEquals(
    await parseAndRender(
      `{{#if .}}Hello{{/if}}`,
      true,
    ),
    `Hello`,
  );
  assertEquals(
    await parseAndRender(
      `{{#if .}}Hello{{/if}}`,
      false,
    ),
    ``,
  );

  assertEquals(
    await parseAndRender(
      `{{#if .}}Hello{{else}}Bye{{/if}}`,
      false,
    ),
    `Bye`,
  );

  assertEquals(
    await parseAndRender(
      `{{#if .}}Hello{{else}}Bye{{/if}}`,
      true,
    ),
    `Hello`,
  );

  assertEquals(
    await parseAndRender(
      `{{#if true}}{{#each people}}* {{name}}\n{{/each}}{{/if}}`,
      {
        people: [
          { name: "Pete" },
          { name: "John" },
        ],
      },
    ),
    `* Pete\n* John\n`,
  );

  // Let directive
  assertEquals(
    await parseAndRender(
      `{{#let @name = "Pete"}}Hello {{@name}}{{/let}} and now {{@name}}`,
      {},
    ),
    `Hello Pete and now undefined`,
  );

  function parseAndRender(template: string, value: any): Promise<string> {
    const parsedTemplate = parseTemplate(template);
    return renderTemplate(parsedTemplate, value, globalVariables, functionMap);
  }
});
