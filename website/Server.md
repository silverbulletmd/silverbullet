Installing SilverBullet as a (local) web server is the most mature, and most flexible way to install SilverBullet. If mature and flexible is your thing, try this option!

The idea is simple: you run the web server (instructions below), point your browser at it and _go, go, go_! You can access the URL via your desktop browser, but also a mobile one. This makes it a great option to access your space from various devices without requiring any type of sync. You could even go _full-on YOLO_ (that’s a technical term), and install it on a public cloud server somewhere and access it that way (be sure to at least enable authentication and put SSL on top of it, though).

You have two options to install and run SilverBullet as a server:

1. Installation right your host system
2. Running it with Docker

## Regular installation
This will work on Linux and macOS machines only. If you're a Windows user, consider [[Desktop]] instead.

Run:

```shell
curl https://silverbullet.md/install.sh | sh
```

This will install `silverbullet` into your current folder. You will likely want to move it to a more convenient location (made sure this is a place where it's writable for future upgrades.)

To run SilverBullet, create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

```shell
./silverbullet <pages-path>
```

By default, SilverBullet will bind to port `3000`, to use a different port use the `--port` flag. 

For security reasons, by default SilverBullet only allows connections via `localhost` (or `127.0.0.1`). To also allow connections from the network, pass a `--hostname 0.0.0.0` flag (0.0.0.0 for all connections, or insert a specific address to limit the host), ideally combined with `--user username:password` to add BasicAuth password protection.

Once downloaded and booted, SilverBullet will print out a URL to open SB in your browser.

## Upgrading SilverBullet
SilverBullet is regularly updated. To get the latest and greatest, simply run:

```shell
./silverbullet upgrade
```

And restart SilverBullet. You should be good to go.

## Installing SilverBullet with Docker

There is a [docker image on docker hub](https://hub.docker.com/r/zefhemel/silverbullet). To use it, first create a volume to keep your space (markdown) files:

```shell
docker volume create myspace
```

Then, run the container, e.g. as follows:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet
```

If you'd like to pass in additional command line arguments (e.g. `--user` to add authentication) you can just append those to the command, e.g.:

```shell
docker run -p 3000:3000 -v myspace:/space -d --name silverbullet zefhemel/silverbullet --user me:letmein
```

To build your own version of the docker image, run `./scripts/build_docker.sh`.

You can also use docker-compose if you prefer. From a silverbullet check-out run:

```shell
PORT=3000 docker-compose up
```

or similar.

To upgrade, simply pull the latest docker image (rebuilt and pushed after every commit to "main") and start the new container.

```shell
docker pull zefhemel/silverbullet
```
