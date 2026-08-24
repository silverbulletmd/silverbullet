---
description: Git-backed revision history integrated into the editor.
tags: glossary
references:
- server/src/revisions/store.rs
- server/src/revisions/engine.rs
- server/src/auth/identity.rs
- client/navigator/views/revisions.ts
---
SilverBullet can keep a full revision history of your [[Space]], backed by an [git](https://git-scm.com/) repository in the space folder. Nothing about it is proprietary: the history is a normal repo you can clone, inspect with `git log`, or pull and push to a remote.

The server that owns the space’s files is what maintains it: so `git` has to be installed there.

Revisions only work when online.

# Modes
The revision mode is configured at a per-space level in [[Space Manager]]:

* **Managed:** Creates a git repository in the space folder if there isn't one, and commits your changes for you.
* **Unmanaged:** Reads the history of a repository that is already there, and **never** commits to it. For a space you version yourself.
* **Disabled:** Nothing. No history is read or written, all `Revisions: *` commands are hidden.

Switching modes later is safe and takes effect on the next restart of the space. A repository SilverBullet created for itself is marked as such (`silverbullet.managed` in the repo's local git config): clearing that mark stops the automatic commits, whatever the configured mode says.

## Setting the mode
* **Desktop app**: in a space's settings, under **Revisions**.
* **[[Space Manager|Multi-space]] server**: in the space's settings, under **Revisions**.
* **Single-space server**: the `SB_REVISIONS` environment variable (`managed`, `unmanaged`, or `disabled`). The default is **unmanaged**.

## Upgrading to a version with revisions
Nothing starts committing to your files on upgrade. What an existing space gets depends on where it runs:

* **Desktop app**: spaces you already have record no mode, so each one is judged on the folder — **Unmanaged** if it is already a git repository (its history becomes browsable, nothing is ever written), **Disabled** otherwise. Switch any of them to Managed when you want SilverBullet to start committing.
* **[[Space Manager|Multi-space]] server**: spaces already in your config have no `revisions` setting, which reads as **Disabled**. Turn it on per space.
* **Single-space server**: with no `SB_REVISIONS` set you get **Unmanaged**. On a space that is already a git repository its history shows up immediately; on a plain folder the views are simply empty until you `git init` it yourself — which the running server picks up without a restart.

Requires `git` on the machine that owns the files. Without it, revisions stay unavailable and the views stay empty rather than erroring.

# Automatic commits
In _Managed_ mode, changes are committed about 30 seconds after things go quiet, and at least every 5 minutes during a long editing session. One commit is made per author, so two people editing at once produce two commits.

Commits are attributed to whoever made the change:

* On a [[Space Manager|multi-space]] server, the acting account's **Full name** and **Email** — set by an admin (on the create-user form or the user's detail page), or by the user themselves on their own **Profile** page.
* In the desktop app, whatever is set in the dashboard's **Profile** section. It defaults to your existing `git config user.name`/`user.email`, so a user who's already configured git gets correct attribution without opening the dashboard.
* **SilverBullet**, for a change made through SilverBullet with no account attached — a single-user server without authentication.
* **External**, for a change SilverBullet detected, but did not make: e.g. another editor, a script, or coding agent.

When an identity has no email of its own, one is synthesized from its name and `revisions.authorEmailDomain` (below).

${widgets.commandButton("Revision: Create snapshot")} commits everything outstanding immediately, rather than waiting.

## Configuring attribution
Under **Revisions** in the [[Configuration Manager]]:

* `revisions.authorEmailDomain`: the domain for synthesized commit emails (`alice@silverbullet.local` by default), used whenever an identity has no email set.

# Browsing history
If revisions is enabled, there will be two additional views:

* ${widgets.commandButton("Revision: Page History")} lists the current page's revisions. Selecting one opens a preview showing the change as a colour-coded diff, switch to **Content** to read the whole page as it was at that point. **Restore** puts that version back into the editor as a single undo step.
* ${widgets.commandButton("Revision: Space History")} lists commits across the whole space. Selecting a commit opens it up to show the pages it touched; selecting one of those previews it the same way.

Whatever has changed since the last commit heads both views as an **Uncommitted changes** entry — in the space-wide log it opens up to list every file involved. Selecting it shows the change; there is nothing to restore, since it is what is already on disk.

# The repository
Under the hood this is just git, so everything you already know works:

```bash
cd /path/to/your/space
git log --oneline
git log --author=alice
git blame index.md
```

You can add a remote and push it, add a `.gitignore` (SilverBullet respects it), or run `git gc`. SilverBullet only ever commits and retrieves old versions: it never pushes, pulls, rebases, or touches branches.

# API
The history is served over HTTP under `/.revisions` — see [[HTTP API#Revisions]] — and from [[Space Lua]] through `space.listRevisions`, `space.getRevision`, `space.getRevisionDiff`, `space.getSpaceLog` and `space.createRevisionSnapshot` (see [[API/space]]).
