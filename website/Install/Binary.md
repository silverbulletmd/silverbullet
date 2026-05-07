#getting-started

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
