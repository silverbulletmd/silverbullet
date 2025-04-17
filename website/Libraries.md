A lot of useful functionality in SilverBullet is implemented through [[Space Lua]] embedded in [[Meta Pages]]. Some of these you will create yourself for your own specific use, but many are generic and generally useful.

By default SilverBullet is distributed with the [[^Library/Std]] library containing some generally useful features. In addition, you can download more libraries via the [[^Library/Std/Import]] mechanism. While this is in no way enforced, it is good practice to store your libraries under `Library/`.

# What’s in a library
Here are some things that a library may provide:
* Various [[Slash Commands]], such as `/today`, `/task`, `/table`.
* Useful [[Page Templates]]
* Useful [[^Library/Std/Widgets]]
* Useful pages that help you perform maintenance on your space, like detecting broken links, such as [[^Library/Std/Pages/Maintenance]].

# Distribution and Importing
We’re still figuring out the best way to distribute libraries. However, one that works already is through SilverBullet’s [[^Library/Std/Import]] mechanism, which enables e.g. importing a library from a Github Gist.

Similarly [[^Library/Std/Export]] can be use to export your library to a Github Gist.

# Can I change libraries locally?
Libraries you manually imported (see previous section) can be freely changed. Do note that if you import them again, you will override your changes.

The [[^Library/Std]] library comes “baked in” with SilverBullet and is read only. You cannot change it. However, for most things there are ways to override or disable standard behavior, check [[Space Lua#Load order]] for some hints.
