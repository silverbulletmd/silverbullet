# SilverBullet Development Guide

## Good practices
* After each significant change, run the typechecker, linter, and tests.
* Write unit tests for new functionality first
* Always keep DEVELOPMENT.md up to date with new best practices, based on guidance.

## Commands
- Build: `deno task build`
- Test: `deno task test`
- Test single file: `deno task test /path/to/test.ts`
- Run all Lua tests: `deno task test common/space_lua/lua.test.ts`
- Lint: `deno task lint`
- Format: `deno task fmt`
- Type checking: `deno task check`
- Watch server: `deno task watch-server <PATH-TO-SPACE>`
- Watch web: `deno task watch-web`
- Watch plugs: `deno task watch-plugs`

## Code Style
- TypeScript: Use explicit types for function parameters and return values
- Imports: Group related imports together, sort alphabetically within groups
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces/types
- Error handling: Use explicit error types and handle errors gracefully
- Tests: Write unit tests for new functionality using `@std/assert` for assertions (e.g., `assert`, `assertEquals`)
- Comments: Focus on "why" not "what", especially for complex logic
- Prefer const over let when variable won't be reassigned
- In Lua: use camelCase for variables and functions
- Tests end with .test.ts

## Architecture Overview

### Plugin System (Plugs)
- **PlugOS**: Extension framework with System, Plug, Sandbox, and Syscalls components
- **Hooks**: Extension points (commands, events, slash commands, widgets)
- **Manifest**: Configuration for plugins defining functions, permissions, and dependencies

### Data Models
- **Pages**: Markdown documents with frontmatter, structured as `ObjectValue`
- **Documents**: Any file type (images, PDFs) with metadata
- **Objects**: Structured data extracted from pages, supporting tagging and attributes

### Key Design Patterns
- Event-driven architecture with EventHook system
- Middleware layers with composable SpacePrimitives implementations
- Syscall pattern for sandboxed plugin functions
- Command pattern for UI and programmatic actions
- Hook system for extension points
- Client-server synchronization with offline support
- Template rendering with query language for data extraction

## Directory Structure

### Top-level Directories
- `/Library`: Standard library shipped with SilverBullet
- `/cmd`: Command-line interfaces and entry points
- `/common`: Shared core functionality for both server and client
- `/lib`: Utility libraries and internal modules
- `/plug-api`: API exposed to plugins (syscalls and utility functions)
- `/plugs`: Built-in plugins that provide core functionality
- `/server`: Server-side implementation (HTTP, storage)
- `/web`: Client-side/browser implementation
- `/website`: Documentation site content

### Key Areas
- `/common/space_lua`: Lua scripting implementation with parsers and runtime
- `/lib/plugos`: Plugin system core functionality
- `/plugs`: Plugs for core functionality (editor, indexing, etc) distributed with the system
- `/web`: Client implementation
- `/web/cm_plugins`: CodeMirror editor extensions
- `/web/hooks`: Client-side hook implementations
- `/web/syscalls`: Client-side specific syscall implementations
