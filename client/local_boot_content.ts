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
  name = "page",
  properties = {
    ref = "string",
    name = "string",
    tags = "string[]",
    created = "string",
    lastModified = "string",
    perm = "string",
  },
})

schema.define({
  name = "document",
  properties = {
    ref = "string",
    extension = "string",
    created = "string",
    lastModified = "string",
    perm = "string",
  },
})
\`\`\``;

const configDefs = `\`\`\`space-lua
config.set("actionButtons", {
  {
    icon = "home",
    description = "Go to the index page",
    command = "Navigate: Home",
    priority = 3,
    dropdown = false,
  },
  {
    icon = "book",
    description = "Open page",
    command = "Navigate: Page Picker",
    priority = 2,
    dropdown = false,
  },
  {
    icon = "terminal",
    description = "Run command",
    command = "Open Command Palette",
    priority = 1,
  },
  {
    icon = "chevron-left",
    description = "Go back",
    standalone = true,
    priority = 0,
    run = function()
      editor.goHistory(-1)
    end,
  },
  {
    icon = "chevron-right",
    description = "Go forward",
    standalone = true,
    priority = -1,
    run = function()
      editor.goHistory(1)
    end,
  }
})
\`\`\``;

const tagDefs = `\`\`\`space-lua
schema.define({
  name = "tag",
  properties = {
    name = "string",
  },
})
\`\`\``;

const userConfig = ``;

export function getLocalBootPages(): string[] {
  return [schemaLua, configDefs, tagDefs, userConfig];
}
