Running SilverBullet locally on your machine is nice, but you likely want to access it from elsewhere as well (other machines on your network, your mobile device), perhaps even from outside your home. For this you either need to use a VPN, or expose SB to the public Internet via _HTTPS_.

In either scenario, be sure to enable some sort of [[Authentication]].

There’s two parts to this process:

1. Run the SilverBullet server itself somewhere, following the [[Install]] instructions
2. Exposing this server to the network/Internet

In all scenarios (that are not local) you _have_ to access SilverBullet via HTTPS, otherwise certain features (such offline-support) won’t work.

People have found various simple to more complex ways of achieving this.

* Using [tailscale](https://community.silverbullet.md/t/install-silverbullet-on-a-64-bit-debian-ubuntu-raspianos-internet-accessible-via-tailscale/48) is likely the lowest friction option.
* [[Deployments/Caddy]]: the easiest solution to expose SilverBullet running on a publicly accessible server to the Internet (but local network as well using Tailscale)

Search the [community’s guide category for more options](https://community.silverbullet.md/c/guides/6).
