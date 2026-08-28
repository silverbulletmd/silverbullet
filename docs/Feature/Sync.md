---
description: The bidirectional synchronisation between the client's local store and the server.
tags: glossary
references:
- client/spaces/sync.ts
- client/service_worker/sync_engine.ts
- plugs/sync/sync.ts
---

SilverBullet is an offline-first web application. Therefore it keeps a copy of your space locally in your browser. It implements a sync engine to continuously keep this local copy in sync with the server (for technical details, see [[Architecture]]).

Sync happens:
* For the entire space: roughly every 20 seconds
* For the currently open file: every 2-3 seconds

Sync runs in a service worker and therefore only runs when the service worker is active. The service worker is automatically kept active for as long as you have a SilverBullet tab or window open. Some browsers slow web apps down when they are in the background or not in an active tab. This may also affect whether sync happens in the background. Most browsers (including mobile ones), keep service workers running for a little while (perhaps up to a minute), even when e.g. the screen is locked, or another app is activated.

## Status
If sync takes longer than a second, a black circle progress indicator will appear in the [[Concept/Top Bar]].

## Conflicts
When multiple clients change the same file around the same time, the server merges them automatically where it safely can; when it can’t (both sides touched the same words), it writes the file with a resolvable in-editor conflict, and you will be notified in the UI when this happens. See [[Feature/Collaboration]] for the full picture.

## Configuration
You can tweak what files are synced locally via a few `config.*` configuration options.

> **note** Note
> Sync related configuration **need** to be done in the [[CONFIG]] page specifically. If they are configured elsewhere they will not be picked up.

By default all your pages are synced, but [[Concept/Document]] are not. They are fetched on demand. If you would also like to sync documents (so you can access them when offline), you can do so by setting the following in a Space Lua block in [[CONFIG]]:

    config.set("sync.documents", true)

In addition, you can fine-tune what files you do _not_ want to sync using [gitignore](https://git-scm.com/docs/gitignore) syntax assigned to the `sync.ignore` option, which accepts either a single string, or a list of strings:

    config.set("sync.ignore", {
      -- Don't sync PDFs and MP4 files
      "*.pdf",
      "*.mp4"
    })

After making changes to these options, you need to reload your client and wait for a sync cycle to kick in until they are applied.
