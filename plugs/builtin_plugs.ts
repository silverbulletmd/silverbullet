// TODO: Figure out how to keep this up-to-date automatically
export const builtinPlugNames = [
  "core",
  "editor",
  "index",
  "sync",
  "plug-manager",
  "emoji",
  "tasks",
  "image-viewer",
];

export const builtinPlugPaths = builtinPlugNames.map((name) =>
  `Library/Std/Plugs/${name}.plug.js`
);
