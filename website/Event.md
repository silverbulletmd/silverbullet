SilverBullet has its own event bus.

Events can be subscribed to and dispatched via the [[API/event]] API. Other features, such as [[Service]] are built on top of Events.

# Built-in events
Here is a list of built-in events (triggered by SilverBullet’s core).
To use them, simply subscribe to them via [[API/event#event.listen(listenerDef)]], and do a `print` to see what data you receive. Alternatively, grep the code base to see exactly where they are triggered.

* `page:click`: user clicks a location on the page
* `page:index`: page has changed and requested to be indexed (used by [[Object]] indexing)
* `editor:complete`: editor completion triggered, returns completion results
* `slash:complete`: slash completion triggered, returns completion results
* `editor:lint`: request to lint, returns errors
* `editor:init`: editor initialized
* `editor:pageLoaded`: page has loaded in the editor
* `editor:pageReloaded`: page reloaded in the editor (e.g. when it was changed on disk)
* `editor:pageSaving`: page is about to save
* `editor:pageSaved`: page has saved
* `editor:pageCreating`: page is creating (can return a page content object)
* `editor:pageModified`: a change was made to the document (real-time)
* `editor:documentSaving`: a document is about to be saved
* `editor:documentSaved`: a document was saved
* `editor:modeswitch`: triggered between vim mode and non-vim mode
* `editor:fold`: code was folded in the editor
* `editor:unfold`: code was unfolded in the editor
* `plugs:loaded`: plugs were loaded
* `cron:secondPassed`: a second has passed (useful to implement cron-like features)
* `hooks:renderTopWidgets`: top widgets have requested to render (return widgets)
* `hooks:renderBottomWidgets`: bottom widgets have requested to render (return widgets)

# All subscribed events
Here’s a dynamically generated list of events that this SilverBullet instance has subscribed to, to give a sense of what’s there:
${query[[
  from event.listEvents()
  where not _:startsWith("service:")
  order by _
]]}
