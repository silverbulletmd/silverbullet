The SilverBullet mobile app is an (almost) full version of SilverBullet running on your mobile device. It keeps its content (pages, attachments) locally, so you have access to it even without an Internet connection. You can install [[🔌 Plugs]], and they run locally as well.

The mobile app is still in beta and available via TestFlight, and initially only available for iOS. The [Android version is coming next](https://github.com/silverbulletmd/silverbullet/issues/310).
![](ios-app-screenshot.png)

[**Join the TestFlight iOS SilverBullet beta**](https://testflight.apple.com/join/QqYAVZcr)

## PWA vs “native” app
On mobile you essentially have two ways to run SilverBullet:

1. Run the [[Server]] and access it via your mobile browser
2. Run the [[Mobile]] app and either maintain a separate space there, or use [[Sync]] to synchronize your content with a [[Server]].

There are a few advantages to using the [[Server]] on a mobile browser:

1. No [[Sync]] required. Content is kept in one place (which you can backup separately).
2. You can access one SilverBullet from any browser on any device, so Android too.
3. Any “heavy lifting” (like indexing pages) happens on the server, not the device.

There are also disadvantages:

1. You need a network connection to the [[Server]] at all times.
2. PWAs don’t always work fully reliably on all devices (specifically iOS)


The advantages of using the “native” mobile app:

1. Fully offline capable: no need for an Internet connection, except for [[Sync]] or any [[🔌 Plugs]] that require one
2. Faster, local performance

The disadvantages:

1. Likely you’ll need to use [[Sync]] to synchronize your content with other devices, this comes with any drawbacks of sync: conflicts, forgetting to sync content etc.

## Implementation
The reason we’re quoting “native” app consistently, is that the mobile app is built using [CapacitorJS](https://capacitorjs.com/). A lightweight wrapper around a WebView exposing various native APIs, such as access to the local file system, SQLite database etc.

The mobile app keeps its files in the sandboxed file system of the SilverBullet app. These files are accessible via iOS file sharing capability (when you plug in your device via USB, you can see all files, copy new ones and remove them), and are included with the regular iOS backups.

## Caveats
* Shell commands: on [[Server]] and [[Desktop]] [[🔌 Plugs]] have the ability to run shell commands, the [[🔌 Git]] plug uses this functionality for instance. This does not work on mobile.
* Local file system access (outside the space): on [[Server]] and [[Desktop]], plugs can get access to your local file system _outside_ the location where your space content is stored. This is used, for instance for [[🔌 Markdown]] sharing as well as `file:` URLs in your [[PLUGS]] file. This is not supported on mobile.