export const localBootConfig = {
  spaceFolderPath: "local",
  indexPage: "index",
  readOnly: false,
  enableClientEncryption: false,
  disableServiceWorker: false,
  localMode: true,
};

const schemaLua = `\`\`\`space-lua
schema.define({
  name: "page",
  properties: {
    ref: "string",
    name: "string",
    tags: "string[]",
    created: "string",
    lastModified: "string",
    perm: "string",
  },
})

schema.define({
  name: "document",
  properties: {
    ref: "string",
    extension: "string",
    created: "string",
    lastModified: "string",
    perm: "string",
  },
})
\`\`\``;

const configDefs = ``;

const tagDefs = `\`\`\`space-lua
schema.define({
  name: "tag",
  properties: {
    name: "string",
  },
})
\`\`\``;

const userConfig = ``;

export function getLocalBootPages(): string[] {
  return [schemaLua, configDefs, tagDefs, userConfig];
}
