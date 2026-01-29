The Object Index stores [[Object|Objects]] found in your [[Space]].

You interact with it in a few ways:

* Indirectly via various other SilverBullet features such as [[Page Picker]], [[Meta Picker]], [[Linked Mention]] etc.
* Via the [[API/index]] API directly

# Indexing
## Initial indexing process
When you launch a fresh client for the first time, the object index will be built from scratch. Depending on the size of your space this can take anything between a few seconds and minutes. If the process takes longer than a few seconds, you will see progress with a blue status circle. Until this initial indexing process finishes, you will notice that things like [[Space Lua/Widget]] and [[Space Lua/Lua Integrated Query]] are not yet rendered, this is to avoid errors and invalid data.

After the initial index process, the index will be kept up-to-date incrementally.

To forcefully reindex your space, run the `Space: Reindex` command.

## Indexing process
Objects are stored in your browser’s IndexedDB, implemented as a thin abstraction layer on top of [[API/datastore]]. Objects are always attached to a particular page.

When SilverBullet detects a page change (either via the editor or based on watching the file system for changes), it will queue reindexing the page.

This process follows the following steps:
1. Remove all existing page-connected objects from the database.
2. Parse the markdown, and broadcast it via the `page:index` event.
3. Various indexers do their magic, resulting in a list of found objects.
4. These objects are stored via the [[API/index#index.indexObjects(page, objects)]] API.

The indexObject API looks at the `tags` of the found objects, and for each tag:

* Looks up the tag spec (see [[API/tag#tag.define(spec)]])
* If the tag spec defines a `schema` and `mustValidate` is set to true, it will validate the object against the schema and only index the object if it passes. If `mustValidate` is not set (the default for performance reasons), no validation will happen at the indexing stage.
* If the tag spec defines a `transform` callback, it is invoked, see [[API/tag#Index augmentation]] for details.
* Stores the resulting objects with for the given tag

# Query
The Object Index is generally queried using [[Space Lua/Lua Integrated Query]]. 

Entry points are:

* [[API/index#index.tag(name)]], e.g.: `index.tag "page"`
* `tags.*`: as a convenience — `tags.page` is equivalent to `index.tag "page"`

If a `metatable` is defined for a particular tag with [[API/tag#tag.define(spec)]], the metatable is set for each object for the tag.