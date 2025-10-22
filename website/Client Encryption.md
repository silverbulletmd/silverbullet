> **warning** Warning
> Client encryption is a beta feature, its implementation may still evolve.

By default SilverBullet keeps a copy of all your files as well as the index, unencrypted in your browser’s IndexedDB. As long as you control your device and other people do not have access to it, this should be perfectly safe. Browsers do not allow access to these databases from other websites and domains.

However, if you are accessing SilverBullet from an “untrusted” device, such as a public computer, this is not a great option, because even after closing your browser all content remains stored on the device unencrypted. You can use commands like `Client: Wipe` and `Client: Logout` to remove data locally, but there’s a chance you will forget at some point.

> **note** Note
> Client encryption right now is only available for users of SilverBullet’s native [[Authentication]] system.

This is what SilverBullet’s **client encryption** is for. When you authenticate using SilverBullet’s [[Authentication]] system, you will have a checkbox “Enable client encryption”. When checked, _all_ your content kept on the client will be encrypted (both your synced files and index). Since no encryption keys are written to disk at any stage, closing your browser or even closing all SilverBullet tabs will flush the key. While content remains on the device, it cannot be viewed without the encryption key derived from your username and password, leaving it useless to malicious actors.

This safety does come at a cost:

1. **Performance:** due to constant encryption and decryption SilverBullet will be slower.
2. **Convenience:** the client-side encryption key (derived from your username and password) will only ever be kept in memory, which means that if you close all your SilverBullet browser tabs and windows, the key will be flushed and you will have to login again.

# Details
Some technical details on how client encryption works.

Note that this is _client_ encryption only, not end-to-end encryption. Data on the server is only encrypted if your space folder is kept on some encrypted volume on the server side. _Transfer_ of data from the client to server is always encrypted via TLS, whether you use client encryption or not.

On the client, all of SilverBullet’s local data storage is built on a small key-value based [abstract interface](https://github.com/silverbulletmd/silverbullet/blob/main/client/data/kv_primitives.ts). By default this interface is implemented to [directly](https://github.com/silverbulletmd/silverbullet/blob/main/client/data/indexeddb_kv_primitives.ts) communicate with your browser’s [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). On top of this we build the sync engine and all our database indexing features. When you enable client encryption, we put a layer in-between: the encryption layer, which based on a cryptographic key will encrypt and decrypt both keys and values on the fly.

A strong 256-bit cryptographic key is derived (using _PBKDF2_) on the client from your username/password combo entered upon login. This key is kept in the service worker for SilverBullet clients to obtain so that the user is not required to constant log in when refreshing a tab, or opening new SilverBullet tabs and windows.

Since we need deterministic and stable encryption for data store keys, we use _AES-CTR_ with a fixed counter. For values we use _AES-GCM_ with randomized ivs.