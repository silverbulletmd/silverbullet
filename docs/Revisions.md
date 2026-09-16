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
The revision mode is configured at a per-space level in [[Dashboard]]:

* **Managed:** Creates a git repository in the space folder if there isn't one, and commits your changes for you.
* **Unmanaged:** Reads the history of a repository that is already there, and **never** commits to it. For a space you version yourself.
* **Disabled:** Nothing. No history is read or written, all `Revisions: *` commands are hidden.

Switching modes later is safe and takes effect on the next restart of the space. A repository SilverBullet created for itself is marked as such (`silverbullet.managed` in the repo's local git config): clearing that mark stops the automatic commits, whatever the configured mode says.

## Setting the mode
* **[[Dashboard|Multi-space]] server**: in the space's settings, under **Revisions**.
* **Single-space server**: the `SB_REVISIONS` environment variable (`managed`, `unmanaged`, or `disabled`). The default is **unmanaged**.

## Upgrading to a version with revisions
Nothing starts committing to your files on upgrade. What an existing space gets depends on where it runs:

* **[[Dashboard|Multi-space]] server**: spaces already in your config have no `revisions` setting, which reads as **Disabled**. Turn it on per space.
* **Single-space server**: with no `SB_REVISIONS` set you get **Unmanaged**. On a space that is already a git repository its history shows up immediately; on a plain folder the views are simply empty until you `git init` it yourself — which the running server picks up without a restart.

# Automatic commits
In _Managed_ mode, changes are committed a short while after things go quiet — about 30 seconds by default, and at least every 5 minutes during a long editing session. On a [[Dashboard|multi-space]] server you can change this per space, under **Commit frequency**: **Responsive** (the default), **Balanced**, or **Relaxed**. A slower setting means fewer, larger commits — and, if [[#Syncing with a remote]] is on, less frequent pushes. One commit is made per author, so two people editing at once produce two commits.

Commits are attributed to whoever made the change:

* On a [[Dashboard|multi-space]] server, the acting account's **Full name** and **Email** — set by an admin (on the create-user form or the user's detail page), or by the user themselves on their own **Profile** page.
* **SilverBullet**, for a change made through SilverBullet with no account attached — a single-user server without authentication.
* **External**, for a change SilverBullet detected, but did not make: e.g. another editor, a script, or coding agent.

When an identity has no email of its own, one is synthesized from its name at the `silverbullet.local` domain (e.g. `alice@silverbullet.local`).

${widgets.commandButton("Revision: Create snapshot")} commits everything outstanding immediately, rather than waiting.

# Syncing with a remote
A managed space can automatically fetch, merge, and push its Git repository. This is primarily a **backup mechanism**, it should not be considered for any type of collaboration.

## Connect a repository
Open the space’s settings and choose **Connect repository** or **Manage Git sync**. The connection page separates setup from ordinary space settings:

1. Enter a **Repository** URL. A repository web address can be converted to its clone address. The effective address is shown before testing.
2. Choose **Deploy key for this space** or **Use server credentials**. The latter means that you manage the server's Git authentication yourself.
3. For a deploy key, generate it, copy its public key, and install it at the repository host with write access. The key must be installed before the connection check can succeed.
4. **Check connection**. The check uses the candidate address and credentials on this page. Editing them invalidates the result. A push preflight is useful, but repository hooks or branch protection can still reject the actual push.
5. Review the destination, branch, local history that will be shared, and remote-check frequency, then **Enable sync**. The connected overview shows the first sync's actual progress and result.

A connection shares committed history, including older versions of files, rather than only the space's current contents. If both repositories have unrelated histories, combining them requires a separate one-time choice. Conflicting pages are resolved as described below.

Deploy-key mode requires SSH and uses the generated key. If that key is missing or deleted, sync stops instead of trying the server's own identities. HTTPS and local repository paths belong to **Use server credentials**. Servers that need custom SSH configuration can use that option too.

## Change or pause a connection
**Edit connection** creates a draft. Its URL, credentials, and frequency do not become active until **Apply changes**. Checking a draft does contact its candidate repository, but does not replace the active remote or merge anything into the space. **Cancel** discards the draft and preserves the active connection. If the active connection is still running while you edit, the page identifies it.

**Pause sync** retains the connection and credentials while stopping background Git network work. **Resume sync** starts it again. Removing a connection preserves the space's files and history. Removing a local deploy key does not revoke the public key at the repository host; remove it there if it should no longer grant access.

The connection is bound to its reviewed destination and branch mapping. If those are changed outside SilverBullet, review the connection before syncing resumes.

## Progress and timing
The connection overview shows live status and the last successful sync. Members can use **Git: View status** and **Git: Review conflicts**; writers can request **Git: Sync now**. Space History also shows Git sync status. Unknown or unavailable status is not the same as being up to date.

Local changes are pushed after an automatic commit. The revisions **Commit frequency** setting controls that timing. **Check remote changes** controls how often SilverBullet checks for other people's commits. **Only when this space changes** disables periodic remote checks, but a sync triggered by your changes still fetches and merges before pushing. It is not a push-only mode.

Pulled changes reach open editors through the normal file-change mechanism. Network failures show an error and retry with backoff. Authentication or configuration problems require repairing the connection.

## Conflicts
When changes cannot merge automatically, **Review conflicts** lists the affected files. For editable Markdown conflicts, the page presents **This space** and **Remote repository**, with choices to keep either side, keep both, or edit manually.

If you edit manually, remove the conflict markers and let the page save. SilverBullet checks the saved text and resolves eligible text conflicts automatically; there is no mandatory Mark resolved step. Partly removed markers keep the conflict open. Resolved files leave the list, and sync resumes when every file has been resolved. The sync status shows whether the resulting push succeeds.

The server only uses marker removal for files that had a supported text conflict. Binary and non-Markdown files require an explicit choice of version. Members can download either original side; writers can keep a side or their edited file. If one side deleted a file and the other edited it, choose whether to keep the edited file or delete it. Unsupported conflict types remain unresolved with an explanation rather than silently choosing a side.

## Scope
Git sync follows one reviewed local/remote branch mapping. It does not create branches, open pull requests, rebase, or force-push. Ordinary local Git commands remain available, but concurrent changes to a merge or its files may require refreshing the conflict view before applying a choice.

# Browsing history
If revisions is enabled, there will be two additional views in the editor:

* ${widgets.commandButton("Revision: Page History")} lists the current page's revisions, newest first. Selecting one opens a preview showing the change as a colour-coded diff, switch to **Content** to read the whole page as it was at that point. **Restore** puts that version back into the editor as a single undo step.
* ${widgets.commandButton("Revision: Space History")} lists commits across the whole space.

Whatever has changed since the last commit heads both views as an **Uncommitted changes** entry — in the space-wide log it opens up to list every file involved. Selecting it shows the change; there is nothing to restore, since it is what is already on disk.
