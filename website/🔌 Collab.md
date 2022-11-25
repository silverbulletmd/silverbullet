---
type: plug
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
share-support: true
---

The Collab plug implements real-time “Google Doc” style collaboration with other Silver Bullet users using the [Yjs](https://yjs.dev) library. It supports:

* Real-time editing
* Showing other participant’s cursors

To use it:

1. Open a page you would like to collaborate on
2. Run the {[Share: Collab]} command and select the collab server to use (an open one runs at `wss://collab.silverbullet.md`)
3. Copy & paste the `collab:...` URI that is injected into the `$share` [[Frontmatter]] and send it to a collaborator **or** if your collaborator is not (yet) a Silver Bullet user, you can use the silverbullet.md website (which is an SB instance) directly via the `https://silverbullet.md/collab:...` URL scheme.
4. If your collaborator is an SB user, have them use the {[Share: Join Collab]} command, or directly open the `collab:...` URI as a page in Silver Bullet (both do the same).
5. If the collaborator wants to keep a persistent copy of the page collaborated page, they can simply _rename_ the page to something not prefixed with `collab:`. Everything will keep working for as long as the `collab:` will appear in the `$share` attribute of [[Frontmatter]]

## How it works
The Collab plug uses Yjs for real-time collaboration via a websocket. A random ID is assigned to every shared page, and a copy of this page (as well as its history) will be stored on the collaboration server. Therefore, be cautious about what you share, especially when using a public collab server like `collab.silverbullet.md`. For “production use” we recommend deploying your own collab server.

## Deploying your own collab server
A detailed description of how to deploy your own collab server, [can be found here](https://github.com/yjs/y-websocket). The short version is:

    HOST=0.0.0.0 PORT=1337 YPERSISTENCE=./store npx y-websocket

This will run the `y-websocket` server on port 1337, and store page data persistently in `./store`. You can connect to this server via `ws://ip:1337`. To use SSL, put a TLS server in front of it, in which case you can use `wss://` instead.