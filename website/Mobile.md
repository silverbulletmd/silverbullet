There is a “native” mobile app under development (the code [lives here](https://github.com/silverbulletmd/silverbullet/tree/main/mobile)). Initially, it will be offered for iOS (and iPadOS), but soon thereafter an Android version is planned.

The mobile app is built using [CapacitorJS](https://capacitorjs.com/) and therefore cross-platform. It essentially wraps the existing web app, and swaps out the server calls to local on-device APIs, such as using the local filesystem to store content (pages and attachments), uses a local SQLite database, and it runs all [[🔌 Plugs]] code on device. It is capable of fully running offline.

The mobile app keeps its files in the sandboxed file system of the SilverBullet app. These files are accessible via iOS file sharing capability (when you plug in your device via USB, you can see all files, copy new ones and remove them), and are included with the regular iOS backups.

In the very likely scenario you’d like to synchronize with your space e.g. on [[Desktop]] or a [[Server]], you’ll need to use [[Sync]].