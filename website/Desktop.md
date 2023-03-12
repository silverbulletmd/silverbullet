SilverBullet is [available as a desktop application](https://github.com/silverbulletmd/silverbullet/releases) for:

* macOS (Intel and ARM)
* Windows (64bit)
* Linux (64bit Intel)

Why would you want to install SilverBullet as a desktop application, as opposed to the more mature [[Server]] version?

1. It’s simpler to get started for most: you don’t need to install Deno, or docker or whatnot. Instead, just download a single package file, install it and _go_.
2. It auto updates (at least on Mac and Windows), so you don’t have to worry about upgrades.
3. It’s easier to open multiple spaces without having to fiddle manually with starting multiple [[Server]] instances on different ports.

Why would you _not_ want to use the Desktop version? You’re limited to only accessing your space on your desktop computer, whereas the [[Server]] simply exposes SilverBullet as a web server you can access from multiple devices. You can use [[Sync]] to work around this issue, however.

Convinced? [visit the releases page](https://github.com/silverbulletmd/silverbullet/releases) to go download it.

## How it works
What the SilverBullet desktop app technically does is spin up a SilverBullet [[Server]] locally on a random port, and then simply point a fancy-looking window (with menus and stuff) at that local URL without all the usual browser chrome (hah, Chrome, funny).

What ships in the desktop package:

1. A copy of Deno for your operating system (this is just a single binary that’s included in the bundle).
2. The current build of silverbullet.js (the everything-in-one bundle that you also download when you install the [[SilverBullet]] from get.silverbullet.md).
3. [Electron](https://www.electronjs.org/)’s Chrome engine.

Functionally, both [[Server]] and [[Desktop]] are on par in terms of how they work and what runs on your computer (except that with the Desktop app you’re running yet another instance of Chrome — because that’s how Electron apps work).