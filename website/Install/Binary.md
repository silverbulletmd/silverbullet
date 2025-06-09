SilverBullet is distributed as a single server binary available for the following platforms:

* macOS (Intel and Apple Silicon) (platform name “darwin”)
* Linux (x86_64 and arm64) (note that this will run on Raspberry Pi as well, but requires a 64-bit Linux distribution)
* Windows (64-bit)

> **note** Note
> Since v2 is still in beta, please use the [edge](https://github.com/silverbulletmd/silverbullet/releases/tag/edge) builds for now, all previous releases are still “v1”

Steps:
1. [Download the binary for your platform from Github](https://github.com/silverbulletmd/silverbullet/releases/tag/edge).
2. Unzip the file in a convenient place
3. Run it from the command line (see below)

You need to create a folder to hold your [[Spaces|space]] files. This folder can be kept anywhere. You can then run `silverbullet` taking the folder path as an argument:

```bash
mkdir sb
./silverbullet sb
```

There are a bunch of [[Install/Configuration]] options you can pass, usually as environment variables.

# Upgrading
You can upgrade your SilverBullet install to the latest edge build using:

```bash
./silverbullet upgrade-edge
```

Release versions will come when the first proper v2 release happens.

# Version
To check which version of SilverBullet you’re running, run the ${widgets.commandButton("Help: Version")} command.
