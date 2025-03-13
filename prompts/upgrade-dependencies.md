# Steps
1. Look at deno.json to find all dependencies under `imports`
3. Find out online (use web search) if there is a NEWER version available for each dependency, exclude the current version number from your search for better results. Note that the esm.sh ones are really npm dependencies, so you may want to search on npmjs.com for the latest version
4. Only when you discover a newer version (higher version number), bump the version number, otherwise leave it as is

After each dependency bump run:
* `deno task check` to ensure type checks
* `deno task test` to ensure all tests still pass
* `deno task lint` to ensure all linting rules are adhered to

Fix any issues as you go along.