#getting-started

To access SilverBullet from another device, make the server reachable on your network.

On a local network, you can use plain HTTP in online-only mode. This requires a live connection to the server and leaves your traffic unencrypted. See [[TLS#LAN HTTP (no TLS)]] for the full list of limitations.

For access over the Internet, use [[TLS]] so your connection is encrypted and SilverBullet's offline features work.

To set this up:
1. Run the server following the [[Install]] instructions and make it reachable from the devices you want to use.
2. Enable [[Authentication]].
3. Set up [[TLS]] for the full feature set, or use LAN HTTP with the limitations above.
