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

If you prefer not to rely on the public `wss://collab.silverbullet.md` server (which will keep persistent copies of all pages shared potentially forever), you can **deploy your own** [following these instructions](https://github.com/yjs/y-websocket).