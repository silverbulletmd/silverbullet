// TODO: Figure out how to keep this up-to-date automatically
export const builtinPlugNames = [
  "editor",
  "index",
  "sync",
  "emoji",
  "image-viewer",
  "configuration-manager",
  "object-graph",
  "git-blame",
];

export const builtinPlugPaths = builtinPlugNames.map(
  (name) => `Library/Std/Plugs/${name}.plug.js`,
);
