A few notes on coding conventions used in this project.

# Tooling

Run these commands to perform type and style checks and automatically reformat code based on conventions:

```bash
make check           # Type check + lint frontend and backend
make fmt             # Format all code
```

# Code Style Guidelines

## TypeScript (client and plugs)

### Import Organization

```typescript
// Use relative imports by default (include .ts extension)
import { Space } from "./space.ts";
// Use `type` for type-only imports (part of the lint rules)
import type { Command } from "./types/command.ts";

// Use package-prefixed absolute when available (defined in deno.json)
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
```

### TypeScript Conventions
* Use `type` over `interface` for object shapes
* Use `type` for unions and complex types
* Always type function parameters explicitly
* Type return values for public APIs
* Let TypeScript infer obvious variable types
* Use `any` for error objects in catch blocks


### Naming Conventions
- **Variables & functions:** `camelCase`
- **Classes:** `PascalCase`
- **Files:** `snake_case.ts` (e.g., `http_space_primitives.ts`)
- **Test files:** `*.test.ts` alongside source files
- **Types:** `PascalCase` (e.g., `PageMeta`, `SpacePrimitives`)
- **Constants:** `camelCase`


### Testing Patterns
TypeScript tests run with Vitest (Node.js).

**Test structure:**
```typescript
import { expect, test } from "vitest";

test("Test description in plain English", async () => {
  // Setup
  const kv = new MemoryKvPrimitives();
  const space = new Space(new DataStoreSpacePrimitives(kv), eventHook);
  
  // Execute
  await space.writePage("test", testPage);
  
  // Assert
  expect(await space.readPage("test")).toEqual(testPage);
});
```

**Assertions:**
```typescript
import { expect } from "vitest";

expect(actual).toEqual(expected);
expect(actual).not.toEqual(notExpected);
expect(value).toBeTruthy();
expect(value).toBeInstanceOf(ClassName);
```

**Running tests:**
```bash
npx vitest run              # Run all tests once
npx vitest                  # Run in watch mode
npx vitest run <file>       # Run specific test file
```

### Comments & Documentation

Use JSDoc for public APIs:
```typescript
/**
 * Lists all pages (files ending in .md) in the space.
 * @param unfiltered - Whether to include filtered pages
 * @returns A list of all pages represented as PageMeta objects
 */
export function listPages(unfiltered?: boolean): Promise<PageMeta[]> {
  return syscall("space.listPages", unfiltered);
}
```

Inline comments:
* In case of doubt: add comments around the _why_ of the code (not what)
* Add TODO comments for known issues

```typescript
// Note: these events are dispatched asynchronously (not waiting for results)
this.eventHook.dispatchEvent(...);

// TODO: Clean this up, this has become a god class
export class Client {
```

### Code Patterns

**Definite assignment for late initialization:**
```typescript
class Client {
  space!: Space;        // Initialized in init()
  editorView!: EditorView;
}
```

**Destructuring:**
```typescript
const { name, def } = command;
const { text, meta } = await this.space.readPage(name);
```

## Go (server)
Follow common Go conventions. `make fmt` also reformats Go code.

## Lua (libraries)
See `website/Space Lua/Conventions`