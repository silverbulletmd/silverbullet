#desktop

SilverBullet [[Desktop]] keeps your space on your computer, and can sync it with a SilverBullet Server so you can reach it from other devices and browsers.

An external Server connection is optional. Without one, Desktop reads and writes the local space folder directly. Configure sync when you want another Desktop installation or a browser on another device to reach the same content.

Choose a Server you control or a hosted instance, then connect the local space below.

# SilverBullet server
## Self-Hosted
For this you need to install [[Install|SilverBullet Server]] somewhere.

**Important:** this deployment cannot live behind an auth proxy (other than SilverBullet’s [[Authentication]]), auth proxies are not (yet) supported.

## Hosted
A hosting provider can run SilverBullet Server for you, see [Hosted SilverBullet](https://silverbullet.md/hosting). This gives you a fully functional SilverBullet Server you can access in a desktop or mobile browser, and it can act as a sync point for SilverBullet Desktop.

## Setup
* In your SilverBullet Desktop dashboard, hover over the space you want to set up for sync and click the gear icon.
* Scroll down to the “Sync” section. Enter the external space’s URL and choose username/password or token authentication. Use an account or token permitted to write that space, then inspect the connection status before relying on another device.

# Dropbox, Syncthing, Git
Ultimately a space is a folder of plain text markdown files on a disk. You can sync it with other devices however you want. If you have multiple machines (e.g. a laptop and desktop, or a private and work laptop) you can use whatever file sync solution you like.

For how sync works in the browser client, see [[Sync]].
