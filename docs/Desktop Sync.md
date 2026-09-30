#desktop

SilverBullet [[Desktop]] keeps your space on your computer, and can sync it with a SilverBullet Server so you can reach it from other devices and browsers.

By default, your space files never leave your machine. That’s great to get started, but chances are you’d also like to access your space from _other_ devices. Perhaps other desktops running SilverBullet Desktop, or perhaps on devices where only a web browser client is available (like mobile devices).

Luckily, the SilverBullet ecosystem got you covered. Here are your options.

# SilverBullet server
## Self-Hosted
For this you need to install [[Install|SilverBullet Server]] somewhere.

**Important:** this deployment cannot live behind an auth proxy (other than SilverBullet’s [[Authentication]]), auth proxies are not (yet) supported.

## Hosted
A hosting provider can run SilverBullet Server for you, see [Hosted SilverBullet](https://silverbullet.md/hosting). This gives you a fully functional SilverBullet Server you can access in a desktop or mobile browser, and it can act as a sync point for SilverBullet Desktop.

## Setup
* In your SilverBullet Desktop dashboard, hover over the space you want to set up for sync and click the gear icon.
* Scroll down to the “Sync” section. There simply enter your SilverBullet instance’s URL and select how you want to authenticate (either via username/password or a token)

# Dropbox, Syncthing, Git
Ultimately a space is a folder of plain text markdown files on a disk. You can sync it with other devices however you want. If you have multiple machines (e.g. a laptop and desktop, or a private and work laptop) you can use whatever file sync solution you like.

For how sync works in the browser client, see [[Sync]].
