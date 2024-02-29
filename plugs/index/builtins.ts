import { ObjectValue } from "../../plug-api/types.ts";
import { system } from "$sb/syscalls.ts";
import { indexObjects } from "./api.ts";
import { QueryProviderEvent } from "../../plug-api/types.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { builtinFunctions } from "$lib/builtin_query_functions.ts";

export const builtinPseudoPage = ":builtin:";

// Types marked with a ! are read-only, they cannot be set by the user
export const builtins: Record<string, Record<string, string>> = {
  page: {
    ref: "!string",
    name: "!string",
    displayName: "string",
    aliases: "string[]",
    created: "!date",
    lastModified: "!date",
    perm: "!rw|ro",
    contentType: "!string",
    size: "!number",
    tags: "string[]",
  },
  task: {
    ref: "!string",
    name: "!string",
    done: "!boolean",
    page: "!string",
    state: "!string",
    deadline: "string",
    pos: "!number",
    tags: "string[]",
  },
  item: {
    ref: "!string",
    name: "!string",
    page: "!string",
    tags: "string[]",
  },
  taskstate: {
    ref: "!string",
    tags: "!string[]",
    state: "!string",
    count: "!number",
    page: "!string",
  },
  tag: {
    ref: "!string",
    name: "!string",
    page: "!string",
    context: "!string",
  },
  attribute: {
    ref: "!string",
    name: "!string",
    attributeType: "!string",
    tagName: "!string",
    page: "!string",
    readOnly: "!boolean",
  },
  anchor: {
    ref: "!string",
    name: "!string",
    page: "!string",
    pos: "!number",
  },
  link: {
    ref: "!string",
    name: "!string",
    page: "!string",
    pos: "!number",
    alias: "!string",
    asTemplate: "!boolean",
  },
  header: {
    ref: "!string",
    name: "!string",
    page: "!string",
    level: "!number",
    pos: "!number",
  },
  paragraph: {
    text: "!string",
    page: "!string",
    pos: "!number",
  },
  template: {
    ref: "!string",
    page: "!string",
    pageName: "string",
    pos: "!number",
    hooks: "hooksSpec",
  },
  table: {
    ref: "!string",
    page: "!string",
    pos: "!number",
  },

  // System builtins
  syscall: {
    name: "!string",
    requiredPermissions: "!string[]",
    argCount: "!number",
  },

  command: {
    name: "!string",
    priority: "!number",
    key: "!string",
    mac: "!string",
    hide: "!boolean",
    requireMode: "!rw|ro",
  },
};

export async function loadBuiltinsIntoIndex() {
  if (await system.getMode() === "ro") {
    console.log("Running in read-only mode, not loading builtins");
    return;
  }
  console.log("Loading builtins attributes into index");
  const allObjects: ObjectValue<any>[] = [];
  for (const [tagName, attributes] of Object.entries(builtins)) {
    allObjects.push({
      ref: tagName,
      tag: "tag",
      name: tagName,
      page: builtinPseudoPage,
      parent: "builtin",
    });
    allObjects.push(
      ...Object.entries(attributes).map(([name, attributeType]) => ({
        ref: `${tagName}:${name}`,
        tag: "attribute",
        tagName,
        name,
        attributeType: attributeType.startsWith("!")
          ? attributeType.substring(1)
          : attributeType,
        readOnly: attributeType.startsWith("!"),
        page: builtinPseudoPage,
      })),
    );
  }
  await indexObjects(builtinPseudoPage, allObjects);
}

export async function syscallSourceProvider({
  query,
  variables,
}: QueryProviderEvent): Promise<any[]> {
  const syscalls = await system.listSyscalls();
  return applyQuery(
    { ...query, distinct: true },
    syscalls,
    variables || {},
    builtinFunctions,
  );
}

export async function commandSourceProvider({
  query,
  variables,
}: QueryProviderEvent): Promise<any[]> {
  const commands = await system.listCommands();
  return applyQuery(
    { ...query, distinct: true },
    Object.values(commands),
    variables || {},
    builtinFunctions,
  );
}
