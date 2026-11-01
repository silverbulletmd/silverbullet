#guide

Choose a workflow by where you want your files to live and who needs access to them. A local folder, a browser’s offline copy and a published collection each serve a different purpose.

# Work on this computer
[[Guide/Desktop Setup|Set up Desktop]] to read and write a [[Local Space|local folder]]. An external Server is optional. Back up the folder with [[Guide/Storage and Recovery]].

# Use your space on multiple devices
To use a local Desktop space from another device, set up [[Desktop Sync]] with a separate SilverBullet Server. The Server provides browser access and a shared synchronization point for Desktop installations.

If you already use Server in a browser and want to keep working without a network connection, use [[Sync|browser offline access]]. Load the space while online and let synchronization finish before disconnecting. Pages excluded by `sync.ignore` and documents that were not cached will be unavailable offline. Server-backed [[Search]], shell commands and other network services still require a connection. See [[PWA]] and [[TLS#LAN HTTP (no TLS)]] for browser requirements.

Desktop reads its local folder directly through its embedded server. It does not need browser-style offline synchronization between its editor and that embedded server.

# Keep changes in Git
Use [[Guide/Git Sync]] to fetch, merge and push committed revision history to a Git remote. Git sync is separate from Desktop–Server sync and browser offline access. For a project maintained through branches and pull requests, see [[Guide/Docs as Code]].

# Share or publish content
* To exchange selected pages with a supported destination, use [[Share]].
* To publish a selected set together, follow [[Guide/Publish a Collection]].
* To let visitors read a whole live space, use [[Publishing]].
* To copy content once to another application, use [[Export]].
* To save a computed result as ordinary Markdown for another renderer, use [[Baked Sections]].

# Keep a recoverable copy
Synchronization can propagate deletions and unwanted edits. Keep recoverable history and a separate backup, and test that you can restore it. [[Guide/Storage and Recovery]] explains what to preserve for Desktop and Server.
