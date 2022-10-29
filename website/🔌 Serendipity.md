---
type: plug
uri: github:m1lt0n/silverbullet-serendipity/serendipity.plug.json
repo: https://github.com/m1lt0n/silverbullet-serendipity
author: Pantelis Vratsalis
---

<!-- #include [[https://raw.githubusercontent.com/m1lt0n/silverbullet-serendipity/main/README.md]] -->
# Serendipity plug for SilverBullet

Serendipity introduces randomness in your navigation to your pages and notes in [silverbullet](https://silverbullet.md/).

The plug includes 3 commands:

* Open a random page: navigates to a totally random page
* Open a random page that contains a tag (e.g. `#hobbies`): narrows down the random pages to only those that have a specific tag
* Open a random page based on a search term (e.g. `performance management`): narrows down the random pages to only those that match the search term.

In order to easily access the commands, all of their names are prefixed with `Serendipity:`.


## Installation

Open (`cmd+k` in Mac and `ctrl+k` in other systems) your `PLUGS` note in SilverBullet and add this plug to the list:

```yaml
- github:m1lt0n/silverbullet-serendipity/serendipity.plug.json
```

Then run the `Plugs: Update` command and you're ready!
<!-- /include -->
