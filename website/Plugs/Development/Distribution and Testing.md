Once your plug works locally, you probably want to ship it to other people. This page covers both.

# Distribution: ship your plug in a Library
Plugs are distributed as part of a [[Library]] — the unit of distribution for all SilverBullet extensions. You don’t publish the `.plug.js` on its own; you publish a library page that carries it.

The recipe mirrors [[Library/Development]]:

1. Create a [[Meta Page]] under `Library/yourname/Your Thing` with frontmatter that lists the plug file:

   ```yaml
   ---
   name: Library/yourname/Your Thing
   tags: meta/library
   files:
     - yourthing.plug.js
   ---
   This library adds …
   ```

2. Drop the compiled `yourthing.plug.js` next to the library page — e.g. `Library/yourname/yourthing.plug.js`. The `files:` list tells the library system to ship the plug along with the page when somebody installs it.
3. Publish the library page with the ${widgets.commandButton "Share: Page"} command (GitHub file, Gist, etc.), which gives the page a public [[URI]].
4. End users install it with ${widgets.commandButton "Library: Install"} using that URI, or discover it through a [[Repository]].
5. Updates: push new versions of the library page via `Share: Page`; installed users pull via the [[Library Manager]].

See [[Library]], [[Library/Development]], [[Share]], [[Repository]], and [[Library Manager]] for the broader library system.

# Testing & debugging
## Browser console
Plugs run in Web Workers, so `console.log` from a plug shows up in the browser’s JavaScript console under the worker entry. Syscalls that perform HTTP (e.g. the [[API/http|http]] / `fetch` syscalls) surface on the main thread — look there in the Network panel, not in the worker context.

## Live reload
Copying a `.plug.js` will be picked up by the sync engine fairly quickly. After this happens, a simple `Plugs: Reload` will (re)load the plug. No page refresh is required.