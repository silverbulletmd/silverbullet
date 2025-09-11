SilverBullet is an offline-first web application. Therefore it keeps a copy of your space locally in your browser. It implements a sync engine to continuously keep this local copy in sync with the server (for technical details, see [[Architecture]]).

Sync happens:
* For the entire space: roughly every 20 seconds
* Open file: every 5 seconds, and immediately when a local change is made

In addition, you can use the ${widgets.commandButton "Sync: Space"} and ${widgets.commandButton "Sync: File"} commands to trigger these manually.

## Status
If sync takes longer than a second, a black circle progress indicator will appear in the [[Top Bar]].

## Conflicts
When you use multiple clients and make changes to the same files simultaneously conflicts may happen. SilverBullet will not attempt to try to merge these conflicts, but rather create a conflicting copy when this happens. You will be notified in the UI when this occurs.

## Configuration
You can tweak what files are synced locally via a few `config.*` configuration options.

> **note** Note
> Sync related configuration **need** to be done in the [[CONFIG]] page specifically. If they are configured elsewhere they will not be picked up.

By default all your pages are synced, but [[Documents]] are not. They are fetched on demand. If you would also like to sync documents (so you can access them when offline), you can do so by setting the following in a Space Lua block in [[CONFIG]]:

    config.set("sync.documents", true)

In addition, you can fine-tune what files you do _not_ want to sync using [gitignore](https://git-scm.com/docs/gitignore) syntax assigned to the `sync.ignore` option, which accepts either a single string, or a list of strings:

    config.set("sync.ignore", {
      -- Don't sync PDFs and MP4 files
      "*.pdf",
      "*.mp4"
    })

After making changes to these options, you need to reload your client and wait for a sync cycle to kick in until they are applied.