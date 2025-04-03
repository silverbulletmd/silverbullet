# Step 1: Lua APIs
The `common/space_lua/stdlib` folder contains implementations of the standard Lua library functions in TypeScript. These APIs should all be documented in a markdown format under `website/API` folder. The markdown files should be named after the Lua module they represent. For example, the `string` module should be documented in `website/API/string.md`.

Ignore the `printf` module, as it is not part of the standard Lua library.

Please compare the APIs implemented in TypeScript and make sure they appear in the API documentation. Add documentation for any missing APIs, follow the same format as the existing documentation.

# Step 2: Syscall documentation
Also in the `website/API` are markdown files for syscalls exposed in SilverBullet. Interfaces for all of theses are implemented under the `plug-api/syscalls/` folder. Each .ts file there should have a matching .md file under `website/API` documenting the APIs using the format similar to `website/API/editor.md`.

Check if all the syscalls defined in the .ts files are present under the API docs, and if not, add them.

For exising API documentation, verify if it is complete and no syscalls are missing. If it is missing, add it.