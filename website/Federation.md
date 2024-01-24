Federation enables _browsing_, and _synchronizing_ (parts of) spaces _outside_ the user’s space into your SilverBullet client.

This enables a few things:

* **Linking and browsing** to other publicly hosted SilverBullet spaces (or websites adhering to its [[API]]). For instance the [[!silverbullet.md/CHANGELOG|SilverBullet CHANGELOG]] without leaving the comfort of your own SilverBullet client.
* **Reusing** content from externally hosted sources, such as:
  * [[Libraries]] synchronization. By federating with `silverbullet.md/Library/Core`, you will get you access to the templates hosted there without copying ({[Library: Import]}‘ing) them and automatically pull in the latest versions.
  * _Data_: such as tasks, item, data hosted elsewhere that you want to query from your own space.

**Note:** Federation does not support authentication yet, so all federated spaces need to be unauthenticated and will be _read-only_.

## Browsing
Browsing other publicly hosted spaces is as simple as navigating to a page starting with `!` such as [[!silverbullet.md/CHANGELOG]].

## Federating
To synchronize federated content into your client, you need to list these URIs in your [[SETTINGS]] under the `federate` key. For instance:

```yaml
federate:
- uri: silverbullet.md/Library/Core/
```

This will synchronize all content under `!silverbullet.md` with a `Library/Core/` prefix (so all templates hosted there) locally.

Currently, content can only be synchronized in read-only mode, so you can not edit the synchronized files. This will likely change in the future.

## Hosting
Tooling to make hosting public spaces is still a work in progress.