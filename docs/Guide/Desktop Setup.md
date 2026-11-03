#guide

SilverBullet Desktop stores each space in a folder on your computer. You can use it without running an external Server. This guide covers setting up that folder, keeping the app updated and optionally using the same content on other devices.

# Install and open a space
Follow [[Install/Desktop]] to download the app for macOS, Windows or Linux. In the dashboard, choose **New space** and select an empty folder, or a folder containing Markdown files you already have.

Open the space and use [[Guide/My First Markdown Page]] to try the editor. [[Local Space]] explains the files Desktop keeps in the folder. Keep the folder’s location somewhere you can find when setting up backups.

# Keep Desktop updated
Use the dashboard’s **Updates** tab to check for a new version and choose **Restart to Update** when a download is ready. Flatpak installations update through Flatpak instead.

# Use the same space on other devices
If you want browser access or another Desktop installation to use the same content, you need a SilverBullet Server. You can [[Guide/Server Setup|run one yourself]] or use a hosting provider.

For an existing local space, open its settings from the dashboard and configure the **Sync** section. To start with a space already on a Server, choose **Join Space**. Follow [[Desktop Sync]] for the supported authentication methods and connection setup, then check that an edit reaches the other device.

This optional synchronization connects your local folder to an external Server. Desktop’s own editor already reads and writes the local folder. There is no browser offline cache to configure between it and its embedded server.

# Protect and troubleshoot your space
Back up your local folder and test a restore into a separate folder. Sync can copy an unwanted edit or deletion to another device, so it does not replace a backup.

If another device is missing an edit, first check the Server sync status in the space’s settings and whether the Server is reachable. If the issue is inside the shared editor, start with [[Log]] and [[Troubleshooting]]. The browser cache reset instructions on that page apply to browser clients, not Desktop’s local files.

For shared configuration and libraries across Desktop spaces, see [[Meta Space]].
