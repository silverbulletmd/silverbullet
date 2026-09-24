---
description: Git-backed revision history integrated into the editor.
tags: glossary
references:
- server/src/revisions/store.rs
- server/src/revisions/engine.rs
- server/src/auth/identity.rs
- client/navigator/views/revisions.ts
---
SilverBullet automatically keeps a full revision history of your [[Space]] backed by an [git](https://git-scm.com/) repository.

# Modes
The revision mode is configured at a per-space level in [[Dashboard]]:

* **Managed:** Creates a git repository in the space folder if there isn't one, and commits your changes for you.
* **Unmanaged:** Reads the history of a repository that is already there, and **never** commits to it. For a space you version yourself.
* **Disabled:** Nothing. No history is read or written, all `Revisions: *` commands are hidden.

# Automatic commits
In _Managed_ mode, changes are committed a short while after things go quiet — about 30 seconds by default, and at least every 5 minutes during a long editing session. You can change this per space, under **Commit frequency**: **Responsive** (the default), **Balanced**, or **Relaxed**. A slower setting means fewer, larger commits.

Commits are attributed to whoever made the change:

* If known, the acting account’s **Full name** and **Email**.
* **SilverBullet**, for a change made through SilverBullet with no account attached — a single-user server without authentication.
* **External**, for a change SilverBullet detected, but did not make: e.g. another editor, a script, or coding agent.

${widgets.commandButton("Revision: Create snapshot")} can be used to commit everything outstanding immediately rather than waiting.

# Syncing with a remote
A managed space can automatically fetch, merge, and push its Git repository. This is primarily a **backup mechanism**, it should not be considered for any type of collaboration.

## Connect a repository
Open the space’s settings and choose **Connect repository** or **Manage Git sync**. The connection page separates setup from ordinary space settings:

1. Enter a **Repository** URL. A repository web address can be converted to its clone address. The effective address is shown before testing.
2. Choose **Deploy key for this space** or **Use server credentials**. The latter means that you manage the server's Git authentication yourself.
3. For a deploy key, generate it, copy its public key, and install it at the repository host with write access. The key must be installed before the connection check can succeed.
4. To choose a specific **Remote branch** for the space's current local branch, check **Choose a remote branch** and enter its name. Otherwise, the connection check uses an existing upstream mapping or detects the remote's default branch. You can use `main`, `master`, or any valid Git branch name. If the selected branch does not exist remotely, the first push creates it.
5. **Check connection**. The check uses the candidate address, branch, and credentials on this page and shows the local-to-remote mapping. Editing any of them invalidates the result. A push preflight is useful, but repository hooks or branch protection can still reject the actual push. Large repositories may take several minutes to check.
6. Review the destination, branch, local history that will be shared, and remote-check frequency, then **Enable sync**. The connected overview shows the first sync's actual progress and result.

A connection shares committed history, including older versions of files, rather than only the space's current contents. If both repositories have unrelated histories, combining them requires a separate one-time choice. Conflicting pages are resolved as described below.

That choice remains valid if either checked history gains commits before the first merge. If a history is rewritten or replaced, sync stops and asks you to edit the connection, check it again, and confirm the new combination. You can recheck and apply a connection without changing its settings.

Deploy-key mode requires SSH and uses the generated key. If that key is missing or deleted, sync stops instead of trying the server's own identities. HTTPS and local repository paths belong to **Use server credentials**. Servers that need custom SSH configuration can use that option too.

## Change or pause a connection
**Edit connection** creates a draft. Its URL, remote branch, credentials, and frequency do not become active until **Apply changes**. Checking a draft does contact its candidate repository, but does not replace the active remote or merge anything into the space. **Cancel** discards the draft and preserves the active connection. If the active connection is still running while you edit, the page identifies it.

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
Git sync follows one reviewed local/remote branch mapping. It can create the selected remote branch on the first push; it does not create local branches, open pull requests, rebase, or force-push. Ordinary local Git commands remain available, but concurrent changes to a merge or its files may require refreshing the conflict view before applying a choice.

# Browsing history
If revisions is enabled, there will be two additional views in the editor:

* ${widgets.commandButton("Revision: Page History")} lists the current page's revisions, newest first. Selecting one opens a preview showing the change as a colour-coded diff, switch to **Content** to read the whole page as it was at that point. **Restore** puts that version back into the editor as a single undo step.
* ${widgets.commandButton("Revision: Space History")} lists commits across the whole space.

Whatever has changed since the last commit heads both views as an **Uncommitted changes** entry — in the space-wide log it opens up to list every file involved. Selecting it shows the change; there is nothing to restore, since it is what is already on disk.
