# Introduction
[Docker](https://www.docker.com/) is a convenient and secure way to install server applications either locally or on a server you control. If you don’t have docker already running on your machine and are macOS user, consider giving [OrbStack](https://orbstack.dev/) a try — it’s a super nice docker experience.

Conveniently, SilverBullet is published as a [docker image on GHCR](https://github.com/silverbulletmd/silverbullet/pkgs/container/silverbullet). The image comes in two flavors:

* 64-bit Intel
* 64-bit ARM (e.g. for Raspberry Pis and Apple Silicon macs)

There is no 32-bit version of Deno, and therefore we cannot offer a 32-bit version of SilverBullet either. Most people run 64-bit OSes these days, an exception may be Raspberry Pis. Recent (RPI 3 and later) can run 64-bit Linux as well, you may have to re-image, though.

A few key things to know about the SilverBullet container image:
* The container binds to port `3000`, so be sure to port-map that, e.g. via `-p 3000:3000` (note: the first `3000` is the external port)
* The container uses whatever is volume-mapped to `/space` as the space root folder. You can connect a docker volume, or a host folder to this, e.g. `-v /home/myuser/space:/space`
* SilverBullet will detect the UNIX owner (UID and GID) of the folder mapped into `/space` and run the server process with the same UID and GID so that permissions will just magically work. If you’d like to override this UID, set the `PUID` and `PGID` environment variables (see [[Install/Configuration]] for details).
* The Docker image is based on Ubuntu. If you would like to install additional packages into it at runtime, you can do so via the `SB_APT_PACKAGES` environment variable, see [[Install/Configuration]].

> **note** Note
> The same docker images are currently both available from [GHCR](https://github.com/silverbulletmd/silverbullet/pkgs/container/silverbullet) and [Docker Hub](https://hub.docker.com/r/zefhemel/silverbullet), use whichever you prefer.

# Setup
For your first run, you can run the following:

```shell
# Create a local folder "space" to keep files in
mkdir -p space
# Run the SilverBullet docker container in the foreground
sudo docker run -it -p 3000:3000 -v ./space:/space ghcr.io/silverbulletmd/silverbullet
```

This will run SilverBullet in the foreground, interactively, so you can see the logs and instructions. 

If this all works fine, just kill the thing with `Ctrl-c` (don’t worry, it’s ok).

Now you probably want to run the container in daemon (background) mode, give it a name, and automatically have it restart after you e.g. reboot your machine:

```shell
docker run -d --restart unless-stopped --name silverbullet -p 3000:3000 -v ./space:/space ghcr.io/silverbulletmd/silverbullet
```

There you go!

Note that to get offline mode to work you need to serve SilverBullet with HTTPS, via for example a reverse proxy.

# Versions
There are two release channels:
* Stable: for this use the `:latest` images
* Edge: for this use the `:v2` tag (e.g. `ghcr.io/silverbulletmd/silverbullet:v2`) — these images are always in sync with the `main` development branch.

To check the version you’re running, use the ${widgets.commandButton("Client: Version")} command.

# Upgrade
You can upgrade SilverBullet as follows:

```shell
# Pull the latest version of the image
docker pull ghcr.io/silverbulletmd/silverbullet
# Kill the running container
docker kill silverbullet
# Remove the old container
docker rm silverbullet
# Start a fresh one (same command as before)
docker run -d --restart unless-stopped --name silverbullet -p 3000:3000 -v $PWD/space:/space ghcr.io/silverbulletmd/silverbullet
```

Since this is somewhat burdensome, it is recommended you use a tool like [watchtower](https://github.com/containrrr/watchtower) to automatically update your docker images and restart them. However, if we go there — we may as well use a tool like _docker compose_ to manage your containers, no?

To upgrade your client, be sure to refresh your page _twice_ somewhat slowly.

# Docker compose
[Docker compose](https://docs.docker.com/compose/) is a simple tool to manage running of multiple containers on a server you control. It’s like Kubernetes, but you know, not insanely complex.

Here is a simple `compose.yml` that runs SilverBullet as well as [watchtower](https://github.com/containrrr/watchtower), which will check for new SilverBullet upgrades daily (the default) and upgrade automatically.

Instructions:
* Please replace the password defined in `SB_USER` with something sensible such as `admin:b3stp4ssword3vah`
* This volume uses the `./space` directory (that presumably exists) in the same directory as the `compose.yml` file as the place where SB will keep its space.
* Check out [[Install/Configuration]] for more interesting `environment` variables you can set.

```yaml
services:
  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet
    restart: unless-stopped
    environment:
    - SB_USER=admin:admin
    volumes:
      - ./space:/space
    ports:
      - 3000:3000
  # To enable auto upgrades, run watchtower
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Boot this up via:

```shell
docker-compose up -d
```

And watch for logs with:

```shell
docker-compose logs -f
```
