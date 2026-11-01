---
description: Git-backed revision history integrated into the editor.
tags: glossary
references:
- server/src/revisions/store.rs
- server/src/revisions/engine.rs
- server/src/auth/identity.rs
- client/navigator/views/revisions.ts
---
SilverBullet automatically keeps a full revision history of your [[Space]] backed by a [Git](https://git-scm.com/) repository.

# Browsing history
If revisions is enabled, there will be two additional views in the editor:

* ${widgets.commandButton("Revision: Page History")} lists the current page’s revisions, newest first. Selecting one opens a preview showing the change as a colour-coded diff, switch to **Content** to read the whole page as it was at that point. **Restore** puts that version back into the editor as a single undo step.
* ${widgets.commandButton("Revision: Space History")} lists commits across the whole space.

Whatever has changed since the last commit heads both views as an **Uncommitted changes** entry — in the space-wide log it opens up to list every file involved. Selecting it shows the change; there is nothing to restore, since it is what is already on disk.

# Modes
The revision mode is configured at a per-space level in [[Dashboard]]:

* **Managed:** Creates a git repository in the space folder if there isn’t one, and commits your changes for you.
* **Unmanaged:** Reads the history of a repository that is already there, and **never** commits to it. For a space you version yourself.
* **Disabled:** Nothing. No history is read or written, all `Revisions: *` commands are hidden.

# Automatic commits
In _Managed_ mode, changes are committed a short while after things go quiet — about 30 seconds by default, and at least every 5 minutes during a long editing session. You can change this per space, under **Commit frequency**: **Responsive** (the default), **Balanced**, or **Relaxed**. A slower setting means fewer, larger commits.

Commits are attributed to whoever made the change:

* If known, the acting account’s **Full name** and **Email**.
* **SilverBullet**, for a change made through SilverBullet with no account attached — a single-user server without authentication.
* **External**, for a change SilverBullet detected, but did not make: e.g. another editor, a script, or coding agent.

`Revision: Create snapshot` can be used with write access to commit everything outstanding immediately rather than waiting.

# Syncing with a remote
A managed space can fetch, merge and push its revision repository. Follow [[Guide/Git Sync]] for setup, timing and recovery. This is primarily for history and backup; use a shared Server space for collaboration.

## Connect a repository
See [[Guide/Git Sync#Connect a repository]].

## Change or pause a connection
See [[Guide/Git Sync#Change or pause a connection]].

## Progress and timing
See [[Guide/Git Sync#Progress and timing]].

## Conflicts
See [[Guide/Git Sync#Conflicts]].

## Scope
See [[Guide/Git Sync#Scope]].
