SilverBullet is distributed as a single server binary available for the following platforms:

* macOS (Intel and Apple Silicon) (platform name “darwin”)
* Linux (x86_64 and arm64) (note that this will run on Raspberry Pi as well, but requires a 64-bit Linux distribution)
* Windows (64-bit)

Steps:
1. [Download the binary for your platform from Github](https://github.com/silverbulletmd/silverbullet/releases).
2. Unzip the file in a convenient place
3. Run it from the command line (see below)

You need to create a folder to hold your [[Space|space]] files. This folder can be kept anywhere. You can then run `silverbullet` taking the folder path as an argument:

```bash
mkdir space
# Run SilverBullet on port 3000 (default)
./silverbullet -p3000 space
```

There are a bunch of [[Install/Configuration]] options you can pass as environment variables.

# MacOS security
SilverBullet binaries are not signed, therefore when you run `silverbullet` on a modern macOS, it will likely refuse to run it.

To work around this, go into your Mac’s System Settings. In the Privacy & Security section, make sure you allow applications from App Store & Known Developers. Once you’ve run `silverbullet` from the CLI already and failed, you’ll see it listed here with an option to override. Select that option and run it again from the CLI, you should now have an addition “Run anyway” button. Click it, authenticate and from this point all should be good.

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
