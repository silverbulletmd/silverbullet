// TODO: Figure out how to keep this up-to-date automatically
export const builtinPlugNames = [
  "core",
  "editor",
  "index",
  "sync",
  "plug-manager",
  "emoji",
  "tasks",
  "search",
  "image-viewer",
];

export const builtinPlugPaths = builtinPlugNames.map((name) =>
  `_plug/${name}.plug.js`
);
