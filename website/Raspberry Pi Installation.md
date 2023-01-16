There are currently no official 64-bit ARM Linux builds available of [Deno](https://deno.land/). However, there are [unofficial ones](https://github.com/LukeChannings/deno-arm64). Here’s how to set that up.

> **Note** Compatibility note
> This only works on **64-bit** versions of Linux. 32-bit is currently unsupported by Deno.

For the record, this was tested on a 64-bit Ubuntu server install on a Raspberry Pi 4. But it should work on any 64-bit Linux.

## Installing Deno
```shell
# Make sure you have unzip installed
$ apt install unzip
# Download a recent Deno build
$ wget https://github.com/LukeChannings/deno-arm64/releases/download/v1.29.1/deno-linux-arm64.zip
# Deno will use this directory for other binaries, so let's put Deno there too
$ mkdir -p ~/.deno/bin
$ cd ~/.deno/bin
$ unzip ~/deno-linux-arm64.zip
```

That’s it. You should now be able to run `~/.deno/bin/deno` just fine.

Add `~/.deno/bin` to PATH, e.g. in `~/.bashrc` add:

```
export PATH=$PATH:~/.deno/bin
```

Then to verify:

```shell
$ source ~/.bashrc
$ deno -V
```

Then, just follow the standard [[SilverBullet]] installation instructions:

```shell
$ deno install -f --name silverbullet -A --unstable https://get.silverbullet.md
$ mkdir ~/Notes
$ silverbullet ~/Notes --hostname 0.0.0.0
```

And access it on `http://ip-of-pi:3000`

Have fun!