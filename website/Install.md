Excited to use SilverBullet? Here are three ways for you to deploy it. Also have a look at the note on [[#File systems]] at the end.

# localhost (desktop, laptop)
While this is not an ideal deployment (it limits accessing your space to _just your own machine_), it is an easy way to get started: simply run the SilverBullet server on your own laptop or desktop.

Steps:
1. Install SilverBullet either as a single [[Install/Binary]] or run it as a [[Install/Docker]] container
2. Access it via `http://localhost:3000`

Is that working out for you? Great, then proceed to deploy SilverBullet _properly_ on a server so you can also access it from other devices (like your phone).

# Self hosted (server)
You can self host SilverBullet on essentially any Intel-compatible 64-bit or ARM 64-bit machine you have terminal access to. The server needs very limited resources (a few hundred megabytes of RAM is sufficient), so even a Raspberry Pi (with a 64-bit OS) is sufficient.

The main hurdle to overcome in deploying SilverBullet on a server is that _it requires [[TLS]]_.

Steps:
1. Login to your server of choice and install SilverBullet there as a single [[Install/Binary]] or as a [[Install/Docker]] container.
2. Decide on your [[TLS]] approach to access it.

Here are a few [community guides](https://community.silverbullet.md/c/guides/6) on how to setup SilverBullet in various (TLS-enabled) setups:

* [Cloudflare Zero Trust](https://community.silverbullet.md/t/use-silverbullet-with-cloudflare-zero-trust/3618): requires a (free) Cloudflare account and domain name, covers TLS and tunneling.
* [Tailscale](https://community.silverbullet.md/t/install-silverbullet-on-a-64-bit-debian-ubuntu-raspianos-internet-accessible-via-tailscale/48): requires a (free) Tailscale account, covers TLS and tunneling and VPN access.
* [Caddy and self-signed certificates](https://community.silverbullet.md/t/level-1-local-https-with-caddy-and-self-signed-certificates/3531): no accounts required, but requires manually accepting certificates.
* [Twingate](https://community.silverbullet.md/t/level-1-access-your-silverbullet-from-outside-your-home-network-using-twingate/3541): requires a Twingate account, covers TLS and tunneling.

# Cloud
While [[Self Hosted]] is the intended path, if this is too much hassle for you. There is a simpler option by using [PikaPods](https://www.pikapods.com/pods?run=silverbullet). For a small fee (about $1.50 per month and you get $5 in credit signing up, so the first months are _free_), you can run your instance there. PikaPods handles deployment, upgrades and backups and exposes SilverBullet securely via TLS.

PikaPods contribute a part of their revenue back to the projects they host, so it’s a source of [[Funding]] for SilverBullet itself.

# File systems
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
