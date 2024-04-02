The most straightforward way to add TLS on top of SilverBulet is to use [Caddy](https://caddyserver.com/). Caddy can automatically provision an SSL certificate for you.

When you’re deploying on a public server accessible to the Internet, you can do this as follows:

```shell
sudo caddy reverse-proxy --to :3000 --from yourdomain.com:443
```

If you’re deploying on a local network and accessing your server via a VPN, this is a bit more tricky. The recommended setup here is to use [Tailscale](https://tailscale.com/), which now [supports TLS certificates for your VPN servers](https://tailscale.com/kb/1153/enabling-https/). Once you have this enabled, get a certificate via:

```shell
tailscale cert yourserver.yourtsdomain.ts.net
```

Caddy can automatically find these certificates once provisioned, so you can just run:

```shell
sudo caddy reverse-proxy --to :3000 --from yourserver.yourtsdomain.ts.net:443
```
