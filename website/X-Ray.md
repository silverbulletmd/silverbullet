X-Ray is an editor lens that shows you the structure SilverBullet’s indexer sees in your document. When switched on, every text range the indexer extracts as an [[Object]] is underlined. When you hover your mouse over it, it will show you all the attributes extracted as [[YAML]].

# Activation
Run ${widgets.commandButton "Editor: Toggle X-Ray"}. The setting is sticky, it persists across page navigations and reloads until you run the command again.

# What’s the point?
* Debugging queries: when a query doesn't match what you expect, X-Ray
  reveals exactly which attributes an object exposes.
* Understanding the indexer: if you do fancy thing with e.g. [[API/tag#tag.define(spec)]], this where you can easily debug the effects.

# Limitations
* `range`-less objects (`page`, `tag`, `aspiring-page`, `anchor`) aren't shown.
* Constructs that the editor renders as a widget may not always show the underline. Hover still works, the tooltip will appear.
