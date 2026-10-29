---
description: A sidebar listing every page and collection you share, with how it compares with its remote.
tags: maturity/beta
references:
- libraries/Library/Std/Infrastructure/Shared Pages.md
- libraries/Library/Std/Infrastructure/Share.md
- libraries/Library/Std/Infrastructure/Share Collections.md
- libraries/Library/Std/Infrastructure/Share Commands.md
---
The Shared Pages view lists every page in your space that is [[Share|shared]], in four groups:
* **Pages**: pages you push, pull or sync.
* **Collections**: your [[Share#Collections|collections]], each with its number of pages and its target (in a narrow sidebar the target may not fit), and its member pages under it. When a collection's `pages` function fails, the error is shown under it instead.
* **Libraries**: installed [[Library|libraries]].
* **Repositories**: installed library repositories.

Open it with ${widgets.commandButton("Navigate: Shared Pages")}. It opens in the right sidebar; from its dock menu you can move it to the left sidebar, the bottom panel or a modal. Each row shows the page's status. Clicking a row opens the page.

# Status
Without asking the remote, the view shows how a _pull_ or _sync_ page compares with its `share.hash`, the record of its last pull or sync:
* no status: unchanged since its last share.
* _changed here_: changed since its last share.
* _no record_: the page has no `share.hash` to compare with, for example because it was never pulled or synced.

_Push_ pages and the pages of collections keep no such record, so they show no status until you Check them.

Hover a status for the full explanation and the page's share mode (`push`, `pull` or `sync`).

# Check
The **Check** button on a group reads the remote of each page in it and shows what it found, until you next act on that page:
* _up to date_: the remote has what a share would send.
* _missing_: nothing is on the remote yet.
* _changed here_: only your page changed.
* _remote changed_: only the remote changed.
* _changed both sides_: both changed.
* _differs_: they differ. For a push page or a collection's page this means sharing would write it; for a pull or sync page, that it has no `share.hash` to tell which side changed.
* _check failed_: the remote couldn't be read; hover the status for the reason. Check never signs in, so a remote you haven't connected to from this device fails here until you share to it once.

A result is also dropped when you edit the page, since it no longer says how the page compares.

Check on a collection reads its target once where the target can list its files, and also adds a row for each file there that is no longer in the collection: _removed_ (hover it for the explanation). Publishing the collection offers those files for removal. When the target can't be read, for example because you haven't signed in to it from this device, every page of the collection shows _check failed_ with the reason. Check on the Collections group checks every collection.

# Actions
On a page:
* **Share**: shares the page, the same as `Share: Page` on it.
* **Open Remote**: opens the shared copy in your browser, where the location has a web address.
* **Copy Link**: copies that web address.

On a collection:
* **Share Collection**: publishes it, the same as `Share: Collection`.

On a collection's page: **Open Remote** and **Copy Link**, for its published copy.

On a library or repository:
* **Update**: updates it from its source, as in the Libraries tab of the [[Workbench]].
* **Open in Libraries tab**: opens the [[Workbench]]'s Libraries tab.

In a read-only space, Check, Share, Share Collection and Update are hidden.
