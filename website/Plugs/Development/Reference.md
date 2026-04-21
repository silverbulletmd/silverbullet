This page is the reference surface for plug authors: the `*.plug.yaml` manifest, every hook type, and the full syscall catalog.

# Manifest
A plug is described by a single YAML file, conventionally named `{plugname}.plug.yaml`. Top-level keys:

* `name`: Plug name (required, must be unique)
* `requiredPermissions`: List of permissions this plug may use. Recognized values: `fetch`, `shell`.
* `functions`: function-name to [[#Function definitions|function mappings]] — the heart of the manifest.
* `assets`: Glob patterns of files to bundle into the plug. Readable at runtime via [[API/asset]] calls.
* `build`: Optional pre-bundle transforms (`esbuild` / `sass` / `copy`). Rarely needed.

## Function definitions
Each entry under `functions:` is one exported plug function. Fields:

| Field | Description |
|-------|-------------|
| `path` | `"file.ts:exportedFunction"` — the TypeScript source to bundle. |
| `redirect` | `"otherPlug.function"` — alias to another plug’s function (no local code). |
| `syscall` | `"myplug.foo"` — expose this function as a syscall callable from other plugs and from [[Space Lua]]. |
| _hook fields_ | Zero or more of `command`, `slashCommand`, `events`, `mqSubscriptions`, `codeWidget`, `editor`, `pageNamespace` — each wires this function into an editor event. See [[#Hooks]] below. |

A function with only a `syscall` field (no other hooks) is a pure library function; a function with one or more hook fields is triggered when the corresponding event fires.

## Examples
A minimal, events-only manifest:

```yaml
name: hello
functions:
  greet:
    path: "./hello.ts:greet"
    events:
      - editor:init
```

A mixed manifest (excerpted from the built-in `index` plug):

```yaml
name: index
functions:
  extractFrontmatter:
    path: api.ts:extractFrontmatter
    syscall: index.extractFrontmatter
  reindexSpaceCommand:
    path: ./command.ts:reindexCommand
    command:
      name: "Space: Reindex"
  processIndexQueue:
    path: ./queue.ts:processIndexQueue
    mqSubscriptions:
      - queue: indexQueue
        batchSize: 3
        autoAck: true
  indexPage:
    path: indexer.ts:indexPage
    events:
      - page:index
```

This one manifest declares a syscall, a command, a message-queue subscriber, and an event subscriber.

# Hooks
Each hook type is a different way for a plug function to be triggered. A single function may declare more than one hook.

## `command`
Declares a [[Command]] available from the command palette and (optionally) via a keybinding.

```yaml
toggleDarkMode:
  path: "./editor.ts:toggleDarkMode"
  command:
    name: "Editor: Toggle Dark Mode"
    key: "Ctrl-Alt-d"
    requireMode: rw          # "rw" or "ro"
    requireEditor: page      # "any", "page", "notpage", or a string editor name
```

All command fields: `name` (required), `key` / `mac`, `priority`, `contexts`, `requireMode`, `requireEditor`, `hide`, `disableInVim`.

```typescript
import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function toggleDarkMode() {
  const current = await editor.getUiOption("darkMode");
  await editor.setUiOption("darkMode", !current);
}
```

## `slashCommand`
Declares a [[Slash Command]] that appears after the user types `/`.

```yaml
insertToday:
  path: ./dates.ts:insertToday
  slashCommand:
    name: today
    description: "Insert today's date"
```

Fields: `name` (required), `description`, `priority`, `onlyContexts`, `exceptContexts`. The context fields restrict the command to (or exclude it from) certain AST node types, e.g. inside fenced code blocks.

```typescript
import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function insertToday() {
  const today = new Date().toISOString().slice(0, 10);
  await editor.insertAtCursor(today);
}
```

## `events`
Subscribes the function to one or more [[Event]] names. Wildcards are supported (e.g. `page:*`). The function receives the event payload.

```yaml
onPageSaved:
  path: ./track.ts:onPageSaved
  events:
    - editor:pageSaved
```

```typescript
import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function onPageSaved(pageName: string) {
  await editor.flashNotification(`Saved ${pageName}`);
}
```

## `mqSubscriptions`
Subscribes the function to a [[API/mq|message queue]]. Useful for background / batched work.

```yaml
processQueue:
  path: ./worker.ts:processQueue
  mqSubscriptions:
    - queue: myQueue
      batchSize: 10
      pollInterval: 5000
      autoAck: true
```

```typescript
import type { Message } from "@silverbulletmd/silverbullet/type/datastore";

export async function processQueue(messages: Message[]) {
  for (const msg of messages) {
    console.log("processing", msg.body);
  }
}
```

## `codeWidget`
Registers a custom renderer for a fenced code block language. The function receives the block body and the current page name, and returns content to render (markdown by default, or HTML in an iframe when `renderMode: iframe`).

```yaml
clockWidget:
  path: ./clock.ts:clockWidget
  codeWidget: clock
```

````typescript
export async function clockWidget(_body: string, _pageName: string) {
  return { markdown: `The time is ${new Date().toLocaleTimeString()}` };
}
````

Triggered when the page contains:

````
```clock
```
````

## `editor` (document editor)
Registers a custom editor for a file extension. The function takes over rendering for files of that type.

```yaml
svgEditor:
  path: ./svg.ts:svgEditor
  editor: ".svg"
```

## `syscall`
Exposes the function as a syscall, callable from other plugs and from Space Lua. Combines with `path:` to provide an implementation. There is no separate TS sketch here — your function is a normal TypeScript function; whatever it returns is the syscall return value.

```yaml
myAdd:
  path: ./math.ts:add
  syscall: myplug.add
```

```typescript
export function add(a: number, b: number) {
  return a + b;
}
```

Other plugs can now `await system.invokeFunction("myplug.add", 1, 2)`, and Lua can call `myplug.add(1, 2)`.

# Syscalls
Plug code reaches the editor, space, and storage exclusively through _syscalls_. Import them from `@silverbulletmd/silverbullet/syscalls`:

```typescript
import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";

await editor.flashNotification("Hi");
const pages = await space.listPages();
```

Under the hood, each of these calls `globalThis.syscall("editor.flashNotification", "Hi")` which is forwarded from the Web Worker to the main thread (`silverbullet/plug-api/syscall.ts`). Syscalls that need a permission throw if the plug didn’t declare it in `requiredPermissions`.

## Available syscalls
All syscalls available to plugs are documented on pages tagged `#api/syscall`:

${template.each(query[[ from p = tags["api/syscall"] where p.tag == "page" order by p.name ]], templates.pageItem)}

## Declaring your own syscall
Any plug function can be exposed as a syscall by adding `syscall: yourplug.foo` to its manifest entry. Other plugs can then call it (via the `system` syscall or the function’s syscall name), and Space Lua code can call it as `yourplug.foo(...)`. See the [[#Syscalls]] above.

## Bundling assets
The `assets:` manifest key bundles files into the plug binary. Read them at runtime with the [[API/asset|asset]] syscall:

```typescript
import { asset } from "@silverbulletmd/silverbullet/syscalls";

const css = await asset.readAsset("myplug", "styles.css", "utf8");
```

Useful for shipping CSS, templates, images, or any other binary blob alongside your code.
