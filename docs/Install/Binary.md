---
tags: getting-started
references:
- bin/silverbullet/src/main.rs
- bin/silverbullet/build.rs
---

SilverBullet is distributed as a single server binary available for the following platforms:

* macOS (Intel and Apple Silicon) (platform name “darwin”)
* Linux (x86_64 and arm64) (note that this will run on Raspberry Pi as well, but requires a 64-bit Linux distribution)
* Windows (64-bit)
* FreeBSD (x86_64)

> **note** Which file should I download?
> The [releases page](https://github.com/silverbulletmd/silverbullet/releases) lists two families of zip files:
> * `silverbullet-server-<os>-<arch>.zip`: **this is what you want**, the actual SilverBullet server.
> * `sb-<os>-<arch>.zip` — the optional [[CLI]] tool (`sb`) for scripting against a _running_ server.

# Steps
We start by [downloading the `silverbullet-server-*` zip for your platform from GitHub](https://github.com/silverbulletmd/silverbullet/releases).

Unzip this archive somewhere convenient. You’ll get a single `silverbullet` executable.

Then, create a folder to hold your data (your server configuration and space files will live here):

```bash
mkdir sb-data
```

Run the server, pointing it at that folder:
```bash
./silverbullet sb-data
```

Since `sb-data` is empty, this opens a first-run setup wizard for accounts and your first space — see [[Space Manager]]. Point the server at a folder that already holds pages instead, and it’s served immediately as a classic single space.

The server listens on `http://localhost:3000` by default. To pick a different port, use `-p`:
```bash
./silverbullet -p 3001 my-space
```

And to bind on an address other than `127.0.0.1` (e.g. to make it reachable on your LAN), use `-L`:
```bash
./silverbullet -L 0.0.0.0 my-space
```

To force classic single-space behavior add `--single`:
```bash
./silverbullet --single my-space
```

> **note** Note
> If you want to access SilverBullet from another machine, you need [[TLS]] _and_ you should enable [[Authentication]] first.

Now, open `http://localhost:3000` in your browser and you’ll be guided through the initial [[Space Manager]], once that’s all done, head to [[Getting Started]] to learn the basics.

# Upgrading
You can upgrade your SilverBullet install based on the version you’d like to run.

To upgrade to the latest **stable** release:
```bash
./silverbullet upgrade
```

To upgrade to the latest **edge** release (which keeps in sync with the `main` development branch):
```bash
./silverbullet upgrade-edge
```

To upgrade your client, be sure to refresh your page _twice_ somewhat slowly.

# Version
To check which version of SilverBullet you’re running, run the ${widgets.commandButton("Client: Version")} command.
