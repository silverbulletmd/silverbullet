#guide

A space’s pages and attachments are files. Browser storage, the client Object Index, the server search index and revision history serve different purposes; none replaces a tested backup of the files you need.

# Back up a Desktop space
Open the space’s settings in the Desktop dashboard. Under **General**, the **Folder** field shows where its files live. Use **Reveal in Finder**, **Show in Explorer** or **Show in File Manager**, depending on your platform, to open that folder.

Let edits finish saving, then include the whole folder in your backup system. Preserve hidden files such as `.git` if you want revision history too. Test a restore into a separate folder before relying on the backup; see the restoration steps below.

# Where data lives
* **Pages and documents:** The space folder on Desktop or Server; the primary content.
* **Browser offline copy:** Browser storage managed by [[Sync]]; documents are opt-in. Clearing browser data can remove unsynchronized edits.
* **Object Index:** Client-side structured data used by queries and views; rebuilt from the space.
* **Full-text and semantic search indexes:** Server-managed search data; see [[Search]] for configuration and rebuild behavior.
* **Revision history:** A Git repository associated with the space; see [[Revisions]] for managed, unmanaged and disabled modes.
* **Server administration:** The Server data folder holds account, space and authentication configuration as well as default space folders.

# Recover an earlier page
1. Open the page and run `Revision: Page History`.
2. Select a revision and inspect its diff or switch to **Content**.
3. With write access, choose **Restore** to put that version into the editor as an undoable edit.
4. Check the result and let it save. Restoration becomes a new change; it does not erase the history you inspected.

Use `Revision: Space History` to find changes across the space. **Uncommitted changes** shows the current files since the last commit, so it is not a previous version to restore. History must have been enabled before the version you need was recorded.

# Recover from a conflict
For concurrent edits in the editor, inspect the conflict widget and resolve the conflicting text; see [[Collaboration#Conflicts]]. For Git remote conflicts, use **Git: Review conflicts** and follow [[Guide/Git Sync#Conflicts]]. Binary files may require choosing between complete versions. Keep both originals until you know which one to retain.

# Back up and test restoration
Back up the space folder, including its Git history if needed. For Server disaster recovery, also preserve the server’s configuration and authentication state; [[Single Sign-On]] identifies the provider configuration and account files. Protect backup credentials as carefully as live credentials.

Restore a backup into a separate folder or disposable Server instance and verify that you can open pages and attachments. Avoid pointing two active instances at the same restored folder. Git sync can provide another copy of committed history, but it does not back up uncommitted files or all Server administration state. Synchronization can copy an unwanted change to every device.
