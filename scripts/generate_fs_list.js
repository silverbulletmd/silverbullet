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

const rootDir = resolve("docs");

getFiles(rootDir).then((files) => {
  files = files.map((file) => ({
    name: file.substring(rootDir.length + 1).replace(/\.md$/, ""),
    lastModified: 0,
    perm: "ro",
  }));
  console.log(JSON.stringify(files, null, 2));
});
