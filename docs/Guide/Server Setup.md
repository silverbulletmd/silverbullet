#guide

SilverBullet Server hosts spaces that people open in a (desktop or mobile) browser. It can also synchronize with [[Desktop]] installations. Use this guide when you operate the Server yourself. People joining an existing Server only need its address and an account.

# Install and create a space
Choose [[Install/Docker|Docker]] or the [[Install/Server Binary|standalone binary]]. Start with an empty data folder and open the Server’s address in a browser. The setup wizard creates your first administrator account and space. [[Dashboard]] explains how to manage additional spaces afterward.

The data folder holds Server configuration and, by default, space folders. Keep it on persistent storage so restarting or replacing a container does not discard it.

# Make it reachable
To reach the Server from another device, follow [[Install/Network and Internet]]. Configure [[Authentication]] and [[TLS]] before exposing a private space over the internet. [[Deployments/Caddy]] gives a reverse-proxy deployment example.

Open the address from the other device and verify that the intended account can access the intended space. For a team, [[Collaboration]] covers shared editing and access. To let visitors read a space without editing it, use [[Publishing]].

# Configure the Server
Manage spaces and accounts through the [[Dashboard]]. Use [[Install/Configuration]] for process settings such as the listening address and port. [[Install/Server Modes]] distinguishes current multi-space setup from legacy single-space deployments.

Editor preferences and space behavior are configured separately through [[Workbench/Configuration]]. Server administrators should also understand [[Security]] before granting write access or enabling capabilities for a space.

# Upgrades
Follow the upgrade instructions for your installation: [[Install/Docker#Upgrading|Docker Compose]], [[Install/Docker#Upgrades|plain Docker]] or [[Install/Server Binary#Upgrading|the binary]]. Back up the data you need before upgrading and check that your spaces open afterward.

# Recovery and troubleshooting
Back up your space files and test restoration. For a full Server restore, preserve configuration and authentication state as well as page and attachment files.

If a space will not open or save, check [[Log]] and [[Troubleshooting]]. Distinguish a Server problem from a browser’s offline copy before resetting client storage: a reset can discard edits that have not reached the Server.
