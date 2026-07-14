#getting-started

Excited to use SilverBullet? Here are three ways for you to deploy it. 

> **note** Note
> There is now a fourth option: the (commercial) [desktop app](https://silverbullet.plus) version of SilverBullet.

# localhost (desktop, laptop)
While this is not an ideal deployment (it limits accessing your space to _just your own machine_), it is an easy way to get started (although [SilverBullet+](https://silverbullet.plus) may be an even lower-friction option to consider): simply run the SilverBullet server on your own laptop or desktop.

Steps:
1. Install SilverBullet following the instructions of one of these options:
   * [[Install/Binary]] — a single self-contained binary
   * [[Install/Docker]] — a docker container
3. Access it via `http://localhost:3000`
4. Follow [[Getting Started]] to learn the basics

Is that working out for you? Great, then proceed to deploy SilverBullet _properly_ on a server so you can also access it from other devices (like your phone).

# Self hosted (server)
You can self host SilverBullet on essentially any Intel-compatible 64-bit or ARM 64-bit machine you have terminal access to. The server needs very limited resources (a few hundred megabytes of RAM is sufficient), so even a Raspberry Pi (with a 64-bit OS) is sufficient.

There are three things to take care of, in this order (follow the links in each for instructions):

1. Install SilverBullet:
   * [[Install/Binary]] — a single self-contained binary
   * [[Install/Docker]] — a docker container
2. Be sure you enable [[Authentication]] for security
3. Deploy a [[TLS]] layer front of SilverBullet: browsers require `https://` (or `localhost`) for SilverBullet’s service worker, crypto, and clipboard APIs to work, so _you cannot_ reach a remote SilverBullet server over plain `http://`.
5. Once that’s all set up, follow [[Getting Started]] to learn the basics of using SilverBullet itself.

Hosting more than one space? Rather than running a separate server process per space, consider [[Multi-Space Mode]]: one process serves any number of spaces, each with its own URL, authentication, and admin UI.

# Cloud
While [[Self Hosted]] is the intended path, if this is too much hassle for you. There is a simpler option by using [PikaPods](https://www.pikapods.com/pods?run=silverbullet). For a small fee (about $1.50 per month), you can run your instance there. PikaPods handles deployment, upgrades and backups and exposes SilverBullet securely via TLS.

PikaPods contribute a part of their revenue back to the projects they host, so it’s a source of [[Funding]] for SilverBullet itself.

# Notes on file systems
## Case insensitive file systems (Mac and Windows)
It is _highly discouraged_ to run SilverBullet (in real use) on a _case insensitive_ file system. SilverBullet assumes your file system is _case sensitive_ and acts accordingly.

> **note** Note
> This only applies to where the SilverBullet _server_ runs, **not** the clients you connect to it (via your browser).

While SilverBullet will run on a case insensitive file system, and everything may _generally_ seem fine, issues start to arise when:
* You edit pages via page names that do not match (case-wise) with their file names on disk.
* When you try to create or edit pages that already exist on disk with different casing.

If you’re deploying **Linux**, you’re likely using a file system that is case sensitive. This is the recommended deployment operating system.

**macOS**’s default file system (APFS) is _case insensitive_ by default as well. However, if you insist on running SilverBullet on macOS, you can create a new APFS Volume for which you enable case sensitivity. You can then use this new volume with SilverBullet.

**Windows**’ native NTFS file system is _case insensitive_ by default, [however there are apparently ways to mark specific folders as case sensitive](https://www.howtogeek.com/354220/how-to-enable-case-sensitive-folders-on-windows-10/). Still, this makes deploying SilverBullet on Windows _not recommended_.

## NAS, sync engines, experimental file systems
While using a NAS to store your space files should be fine, if you encounter issues (unreliable saving, sync issues) it is worth switching to a local file system to see if this resolves those issues. The same goes for synchronizing your files from your server elsewhere, e.g. using tools like SyncThing. They _should_ work fine, but if you run into [[Sync]] issues, disable everything, switch to a local file system and see if the issues persist to [[Troubleshooting]].

SilverBullet’s sync engine relies on reliably persisting **last modified timestamps** for your files, and those timestamps only being touched when actual changes to those file occur. If your file system (or NAS) does not persist these consistently, or you have some external sync process that updates them — this may lead to problems. 
