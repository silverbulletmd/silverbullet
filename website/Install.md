Excited to use SilverBullet? Here are three ways for you to deploy it.

# localhost (desktop, laptop)
While this is not an ideal deployment (it limits accessing your space to _just your own machine_), it is an easy way to get started: simply run the SilverBullet server on your own laptop or desktop.

Steps:
1. Install SilverBullet either as a single [[Install/Binary]] or run it as a [[Install/Docker]] container
2. Access it via `http://localhost:3000`

Is that working out for you? Great, then proceed to deploy SilverBullet _properly_ on a server so you can also access it from other devices (like your phone).

# Self hosted (server)
You can self host SilverBullet on essentially any Intel-compatible 64-bit or ARM 64-bit machine you have terminal access to. The server needs very limited resources (a few hundred megabytes of RAM is sufficient), so even a Raspberry Pi (with a 64-bit OS) is sufficient.

The main hurdle to overcome in deploying SilverBullet on a server is that _it requires [[TLS]]_.

Steps:
1. Login to your server of choice and install SilverBullet there as a single [[Install/Binary]] or as a [[Install/Docker]] container.
2. Decide on your [[TLS]] approach to access it.

Here are a few [community guides](https://community.silverbullet.md/c/guides/6) on how to setup SilverBullet in various (TLS-enabled) setups:

* [Cloudflare Zero Trust](https://community.silverbullet.md/t/use-silverbullet-with-cloudflare-zero-trust/3618): requires a (free) Cloudflare account and domain name, covers TLS and tunneling.
* [Tailscale](https://community.silverbullet.md/t/install-silverbullet-on-a-64-bit-debian-ubuntu-raspianos-internet-accessible-via-tailscale/48): requires a (free) Tailscale account, covers TLS and tunneling and VPN access.
* [Caddy and self-signed certificates](https://community.silverbullet.md/t/level-1-local-https-with-caddy-and-self-signed-certificates/3531): no accounts required, but requires manually accepting certificates.
* [Twingate](https://community.silverbullet.md/t/level-1-access-your-silverbullet-from-outside-your-home-network-using-twingate/3541): requires a Twingate account, covers TLS and tunneling.

# Cloud
While [[Self Hosted]] is the intended path, if this is too much hassle for you. There is a simpler option by using [PikaPods](https://www.pikapods.com/pods?run=silverbullet). For a small fee (about $1.50 per month and you get $5 in credit signing up, so the first months are _free_), you can run your instance there. PikaPods handles deployment, upgrades and backups and exposes SilverBullet securely via TLS.

PikaPods contribute a part of their revenue back to the projects they host, so it’s a source of [[Funding]] for SilverBullet itself.
