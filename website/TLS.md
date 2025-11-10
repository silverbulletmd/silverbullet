SilverBullet relies on a few advanced browser features to operate (specifically service workers, crypto APIs and clipboard APIs). These features are _only_ enabled by browsers when websites are accessed via `http://localhost` or via [TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security), that is: a `https://` URL.

This is not a limitation imposed by SilverBullet, it is a restriction encoded in web standards.

Therefore, to use SilverBullet you need to either access it via `localhost` or put a TLS certificate on it.

# localhost (http)
You can do this in a few ways:

## Run SilverBullet locally
If you run SilverBullet _locally_ on your machine, this is the easiest option. Everything runs fine as long as the browser sees `localhost` or `127.0.0.1` appear in the URL, even with `http://`.

The obvious drawback of this approach is that your SilverBullet instance is only accessible from the machine you run it on.

## SSH tunnel
If you run SilverBullet on a remote server in your network that you have SSH access to, you can “fake” a localhost URL by creating an SSH tunnel.

You can do this as follows:
```bash
ssh -N -L 3002:localhost:3000 user@someip
```

This will tunnel your localhost port 3002 (accessible via http://localhost:3002) to port 3000 on the `someip` server. Stop the tunnel with `Ctrl-c`. To keep the tunnel running in the background, add the `-f` option.

Compared to running it locally this is _slightly_ better, because you can now access SilverBullet from any machine you can create an SSH tunnel from.

## Local (Caddy) reverse proxy
If you don’t (or can’t) use SSH, you can create a [Caddy](https://caddyserver.com/) reverse proxy. [Install Caddy](https://caddyserver.com/docs/install) first, then create a `Caddyfile`:

```
localhost:3002 {
    reverse_proxy someip:3000
}
```
And run Caddy with:
```bash
caddy run --config /path/to/Caddyfile
```
Now you can access your remote server via `http://localhost:3002`

# TLS (https)
For this, you need to get your hands on a TLS certificate.

A few options:

## Tailscale SSL certificate
If you’re a [Tailscale](https://tailscale.com/) user, this a simple solution. If not, you may consider becoming one — it’s a good service, and _free_ for this use case.

Part of the [guide to setup SilverBullet on Linux](https://community.silverbullet.md/t/install-silverbullet-on-a-64-bit-debian-ubuntu-raspianos-internet-accessible-via-tailscale/48) are instructions on how to install  (a free service) and use it to expose a local server (like SilverBullet) locally on your VPN, or the Internet — a setup that gives you a `.ts.net` subdomain with TLS certificate. 

The advantage of this approach is that you have the choice to expose your SilverBullet to the wide Internet, or limit it to just your Tailscale VPN. The disadvantage is that you now rely on a third party (Tailscale).

## Cloud VM with Caddy
There a various affordable providers of cloud servers that can be used to self-host SilverBullet in the cloud. It is significantly easier to get a TLS certificate issued on a publicly exposed server.

The recommended approach for this requires two things:

1. An Internet exposed cloud server. Affordable options include:
   * [Hetzner Cloud](https://hetzner.cloud/?ref=6jW03LSGlJKf) (referral link) starting from about 3.5 euro/month
   * [Vultr](https://www.vultr.com/products/cloud-compute/) starting from about $2.5/month
2. A domain name that you can configure DNS records on to point to your server

After deploying SilverBullet on the VM (with [[Authentication]], obviously), you can deploy [Caddy](https://caddyserver.com/) next to it with a reverse proxy. Caddy has the ability to request an install a TLS certificate built in. 

For this, [install Caddy](https://caddyserver.com/docs/install) into your VM. Then, in your Caddyfile (usually located `/etc/caddy/Caddyfile`) put:

```
silverbullet.mydomain.com {
    reverse_proxy localhost:3000
}
```

Replace `silverbullet.mydomain.com` with any domain that you have configured to resolve to the IP of your server, and the `:3000` port with whatever local port you run SilverBullet on.

Restart Caddy and access SilverBullet via `https://silverbullet.mydomain.com`. On first load, Caddy will use [certbot](https://certbot.eff.org/) to issue a TLS certificate and install (and update) it automatically.

## Self-signed certificate
It is possible to self sign certificates and use those. Search the Internet for instructions on how to do this, [here is website that describes the way it works and how to do it](https://www.ssldragon.com/blog/what-is-self-signed-certificate/).

# Alternative: Pikapods (SaaS)
If you’re ok having your SilverBullet instance be hosted by a third party, consider using [PikaPods](https://www.pikapods.com/pods?run=silverbullet). From about $1.50/month you can host SilverBullet there. It will automatically install and update SilverBullet for you, and expose it on a sub-domain via https.