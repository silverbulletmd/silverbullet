#desktop

A local space is a folder on your computer that SilverBullet Desktop opens as a [[Reference/Concepts/Space]]. Desktop can manage any number of them.

# Managing spaces
Each space is a separate folder on disk with its own configuration, sync settings and environment. The Desktop dashboard lists your spaces. Switch between them instantly, open several in their own windows, and Desktop restores their state between sessions.

Because a space is a plain folder of Markdown files, you can also open it with other tools, keep it in [[Git]], or sync it with a file sync service (see [[Desktop Sync]]).

**Remove space**, under a space's General settings, removes it from the dashboard and leaves its folder on disk. Tick **Also delete all my files** to permanently delete the folder and everything in it as well; this cannot be undone. For a space that syncs, only the copy on this computer is deleted. Desktop refuses to delete a folder that is, holds or sits inside another space's folder, or one that holds your home folder.

# Global keyboard shortcuts
Bind system-wide keyboard shortcuts to any SilverBullet [[Reference/Concepts/Command]] in any space.

# From the terminal
The `sb` command opens files and folders in Desktop, evaluates [[Reference/Space Lua]] against a running space, and manages spaces. See [[Integrations/CLI]].

# Sharing configuration between spaces
To make configuration and libraries available in every local space, use a [[Meta Space]].

# Recovery
A local folder works without an external Server. Keep a separate backup and review [[Revisions]] settings before relying on automatic history.
