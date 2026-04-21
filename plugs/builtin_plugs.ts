// TODO: Figure out how to keep this up-to-date automatically
export const builtinPlugNames = [
  "core",
  "editor",
  "index",
  "sync",
  "emoji",
  "image-viewer",
  "configuration-manager",
];

export const builtinPlugPaths = builtinPlugNames.map(
  (name) => `Library/Std/Plugs/${name}.plug.js`,
);
