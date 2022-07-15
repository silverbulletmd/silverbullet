const { resolve } = require("path");
const { readdir } = require("fs").promises;

async function getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    })
  );
  return Array.prototype.concat(...files);
}

const rootDir = resolve("website_build/fs");

getFiles(rootDir).then((files) => {
  files = files
    .map((file) => ({
      name: file
        .substring(rootDir.length + 1)
        .replace(/\.md$/, "")
        .replace(/\.plug\.json$/, ""),
      lastModified: 0,
      perm: "rw",
    }))
    .filter((pageMeta) => !pageMeta.name.startsWith("."));
  console.log(JSON.stringify(files, null, 2));
});
