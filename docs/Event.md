---
description: A named signal that plugs and Lua scripts can listen to and react to.
tags: glossary
---
SilverBullet has its own event bus that allows different parts of the system to communicate. Events are the foundation for much of SilverBullet's extensibility — features like [[Service]], [[Virtual Pages]], widgets, and custom indexing are all built on top of events.

# Subscribing to events
Use `event.listen` to subscribe to an event:

```lua
event.listen {
  name = "editor:pageLoaded",
  run = function(e)
    print("Loaded page: " .. e.data.name)
  end
}
```

The `run` callback receives an event object with a `data` field containing event-specific information. To see what data an event provides, add a `print` call and check the [[Log|logs]].

# Dispatching events
You can dispatch your own custom events:

```lua
event.dispatch("my-custom-event", {message = "Hello!"})
```

Other scripts can then listen for `my-custom-event`.

# Built-in events
Here is a list of built-in events triggered by SilverBullet's core:

## Editor events
* `editor:init`: Editor has initialized
* `editor:pageLoaded`: A page has been loaded in the editor
* `editor:pageReloaded`: A page was reloaded (e.g. after being changed on disk)
* `editor:pageSaving`: A page is about to be saved
* `editor:pageSaved`: A page has been saved
* `editor:pageCreating`: A page is being created (can return content — used by [[Virtual Pages]])
* `editor:pageModified`: A change was made to the document (fires in real-time)
* `editor:documentSaving`: A document (non-page file) is about to be saved
* `editor:documentSaved`: A document was saved
* `editor:modeswitch`: Toggled between [[Vim]] mode and normal mode
* `editor:fold`: Code was folded in the editor
* `editor:unfold`: Code was unfolded in the editor

## Interaction events
* `page:click`: User clicked a location on the page
* `editor:complete`: Editor completion triggered — return completion results to extend [[Completion]]
* `slash:complete`: Slash completion triggered — return completion results
* `editor:lint`: Lint request — return errors to show in the editor

## System events
* `page:index`: A page has changed and needs to be indexed (used by [[Object]] indexing)
* `plugs:loaded`: Plugs were loaded
* `cron:secondPassed`: One second has passed (useful for implementing periodic behavior)

## Widget events
* `hooks:renderTopWidgets`: Top widgets requested to render — return widgets to display above the page content
* `hooks:renderBottomWidgets`: Bottom widgets requested to render — return widgets to display below the page content

# All subscribed events
Here’s a dynamically generated list of events that this SilverBullet instance has subscribed to, to give a sense of what’s there:
${query[[
  from event.listEvents()
  where not _:startsWith("service:")
  order by _
]]}

See [[API/event]] for the full API reference.
