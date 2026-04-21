A **plug** is a self-contained JavaScript bundle (`*.plug.js`) that extends SilverBullet. It runs inside a sandboxed [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), talks to the editor via [[API|syscalls]], and hooks into SilverBullet through commands, events, slash commands, message queues, and more.

A big chunk of SilverBullet itself is implemented as a mix of [[Space Lua]] and built-in plugs, so it’s also worth exploring [built-in plugs source code](https://github.com/silverbulletmd/silverbullet/tree/main/plugs) to get a feel for how things work.

This section covers the basics to build, test, and distribute your own plug:

* [[Plugs/Development/Architecture]]: how plugs are loaded, executed, and sandboxed
* [[Plugs/Development/Reference]]: `*.plug.yaml` manifests, hook types, and the syscall catalog
* [[Plugs/Development/Distribution and Testing]]: packaging a plug as a [[Library]], testing, debugging

# Quick start
The easiest way to start is to click the “Use this template” button on the [silverbullet-plug-template](https://github.com/silverbulletmd/silverbullet-plug-template) repo. Then:

```shell
npm install
npm run build
```

This produces a `yourplug.plug.js` bundle. For development, copy somewhere in your [[Space]] (it doesn’t really matter where):

```shell
cp yourplug.plug.js ~/myspace/
```

Within a few seconds watch your browser’s JavaScript console — the plug file should be synced locally. You can now run the `Plugs: Reload` command to “hot” reload it, without a full page.

# Hello world
A minimal plug consists of two files: a YAML manifest and the TypeScript source it references.

**`hello.plug.yaml`**

```yaml
name: hello
functions:
  helloCommand:
    path: "./hello.ts:helloCommand"
    command:
      name: "Hello: World"
```

**`hello.ts`**

```typescript
import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function helloCommand() {
  await editor.flashNotification("Hello, world!");
}
```

Build, copy into your space, plug reload, and a `Hello: World` should now be available as a command from the [[Command Palette]]. When it’s run you should see a “Hello world!” message flash.

From here, read [[Plugs/Development/Architecture]] to understand what’s happening under the hood, then [[Plugs/Development/Reference]] for the full manifest/hook/syscall surface.
