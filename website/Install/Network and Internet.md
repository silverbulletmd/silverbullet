Running SilverBullet locally on your machine is nice, but you likely want to access it from elsewhere as well (other machines on your network, your mobile device), perhaps even from outside your home. 

> **note** IMPORTANT
> To use SilverBullet from anywhere other than localhost, you have to set up [[TLS]]. SilverBullet does not work (other than via localhost) on URLs other than `https://` ones.

For this, be sure to enable [[Authentication]].

There’s two parts to this process:
1. Run the SilverBullet server itself somewhere, following the [[Install]] instructions
2. Exposing this server to the network/Internet via [[TLS]]
