Running SilverBullet locally on your machine is cool and all, but you likely want to access it from elsewhere as well (other machines on your network, your mobile device), perhaps even from outside your home. For this you either need to use a VPN, or expose SB to the public Internet via _HTTPS_.

In either scenario, be sure to enable some sort of [[Authentication]].

There’s two parts to this process:

1. Run the SilverBullet server itself somewhere, following the [[Install]] instructions
2. Exposing this server to the network/Internet

In all scenarios (that are not local) you _have_ to access SilverBullet via HTTPS, otherwise certain features (such offline-support) won’t work.

People have found various simple to more complex ways of achieving this.

* Using [[Deployments/ngrok]] is likely the easiest solution to exposing your _locally running_ SilverBullet to the Internet. Note that “locally running” can mean your own local machine, but can still refer to running it on a server in your network (like a Raspberry Pi).
* [[Deployments/Caddy]]: the easiest solution to expose SilverBullet running on a publicly accessible server to the Internet (but local network as well using Tailscale)
* [[Authelia]] setup hints
* Deploy directly to the cloud via [[Install/Deno Deploy]]
