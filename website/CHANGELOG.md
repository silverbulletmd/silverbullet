An attempt at documenting the changes/new features introduced in each release.

## Edge
These are changes live on the edge builds:

* Sync engine re-architecture: see [[Architecture]] and [[Sync]]
* More configuring what to index (see [[^Library/Std/Config]] under the `index` section) for the purpose of reducing local storage size and needless CPU waste. Some useful ones:
  * `config.set("index.search.enable", false)` to disable [[Full Text Search]] entirely (saves on processing and storage if you don’t use it)
  * `config.set("index.paragraph.all", false)` to disable indexing all (untagged) paragraphs. This is also somewhat wasteful if you don’t query these.
* A lot of little polish

## 2.0.0
* We’re now live!

For previous versions, see [the v1 CHANGELOG](https://v1.silverbullet.md/CHANGELOG)