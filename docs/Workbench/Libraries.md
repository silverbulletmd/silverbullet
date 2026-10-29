---
description: "Install, update and remove libraries, plugs and repositories."
references:
- client/workbench/libraries/**
---
The Libraries tab manages the [[Library|libraries]] in your space. In a read-only space it only shows what's there: installing, updating, removing and checking for updates are hidden, with a note saying why (a read-only server doesn't reach other servers, so there is nothing to check against). It reloads every time you show the tab, so what you see matches your space.

${widgets.commandButton("Workbench: Libraries")} opens this tab in the [[Workbench]].

The toolbar has:

* **Filter libraries**: narrows installed libraries by name and available ones by name, description and page.
* **Install…**: asks for a library or plug URI (`https://…` or `github:…`) and installs it. For a plug (a URI ending in `.plug.js`) it also asks where to save it.
* **Add repository…**: asks for a [[Repository]] URI and the page to put it on, then adds it so its libraries show up under Available.
* **Check for updates**: compares each installed library and repository with its source, and shows the result beside it (see below).
* **Update all**: updates every installed library that can be updated, with progress. It only shows when there is something to update.

Below it are three sections, each with its own error and info banner:

* **Installed**: the libraries you installed, plus plugs that no library brought along. Built-in libraries (on `Library/Std/` pages, or without a share URI) are marked *built-in* and can’t be updated or removed. Libraries in dev mode are marked *dev mode* and are left alone, too. Click a row to open its page.
* **Available**: the libraries your repositories offer, grouped by repository, with the recommended Std repository first. **Install** puts one in your space. Available library titles open their configured website. When no website is configured, the title opens the library’s source page using the browser URL for its URI (for example, expanding a `github:` URI to its GitHub file page).
* **Repositories**: the [[Repository|repositories]] you added, with **Update all** to refresh all of them; any that fail are listed with the reason. The built-in Std repository is read-only.

An installed library or repository row shows its share URI. Its context menu offers:
* *Update*: pulls the latest version from its source. When you edited a library here and its source changed too, it asks before replacing your edits.
* *Revert*: in place of *Update* when a check found a library **changed locally** (edited here, unchanged at its source): discards your edits and restores the installed version, after asking.
* *Open page*: opens its page, the same as clicking the row.
* *Copy URI*: copies its share URI.
* *Remove*: removes it, after asking.

Plugs only offer *Remove*.

# Checking for updates
**Check for updates** reads the source of every library you installed (not built-in or dev-mode ones) and every repository you added.
