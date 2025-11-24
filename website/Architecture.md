Here is a big-picture (conceptual) architecture of SilverBullet:
```excalidraw
url:architecture.excalidraw
height:800px
```

# Client
The client is what you see when you open SilverBullet in a browser tab or window. It renders the UI, interacts with the user and runs most of the logic. 90%+ of logic in SilverBullet lives here.

## Editor
The editor is built on [CodeMirror](https://codemirror.net/) with a lot of [[Markdown/Extensions]] to its default Markdown mode.

## Space Lua
SilverBullet contains a custom [[Lua]] runtime called [[Space Lua]]. It should be your first go-to when you are interested in extending SilverBullet to your like. Space Lua implements the majority of the Lua 5.4 standard library (where it makes sense), but also includes some additional Space Lua-specific [[API]]s. In addition all [[#Syscalls]] are accessible from Space Lua.

When Lua code gets too complicated or performance is more of a concern, the next level is to build your extension in TypeScript as a plug.

## Plugs
[[Plugs]] and the PlugOS library that implements are a generic means to extend SilverBullet. Code is written in TypeScript and compiled into a single JavaScript `.plug.js` bundle that can be distributed as part of a [[Library|Library]]. 

A lot of [“built in” functionality](https://github.com/silverbulletmd/silverbullet/tree/main/plugs) in SilverBullet in in fact implemented as plugs, partially to “stress test” this infrastructure. 

## Syscalls
Syscalls (system calls) are the abstraction used in SilverBullet to cleanly create an API boundary between SilverBullet and extension code (Plugs or Space Lua). A lot of functionality core to SilverBullet (in the editor, the event system, datastore) are exposed through syscalls.

## Events and services
[[Event]]

## Datastore


The client interacts with the service worker and server primarily via the [[HTTP API]], which exposes CRUD-style operations on files.

# Service Worker
The [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)’s role is to make SilverBullet offline capable. When enabled (it is enabled by default) it:
* Caches and serves the SilverBullet client code
* [[Sync|Syncs]] files with a local database
* Implements the [[HTTP API]], but handles it locally (where appropriate)

It does this by intercepting HTTP calls coming from the client aimed at the server.

The service worker embeds a [[Sync]] engine, that based on configuration constantly keeps a local copy of your files in sync with the server. To make the sync status visible, it emits events to the Client.

For debugging purposes you can disable the service worker by adding `?enableSW=0` to your URL. This disabling is persistent, to re-enable it use `?enableSW=1`.

# Server
The server has only three jobs:

* Handle authentication
* Serve the (static) client code
* Implement the [[HTTP API]], which mainly means listing, reading, writing and deleting files, and executing shell commands.

Note that all indexing, querying etc. happens in the client. The server effectively acts as a file store.
