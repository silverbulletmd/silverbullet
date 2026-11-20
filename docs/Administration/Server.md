SilverBullet Server hosts spaces that people open in a (desktop or mobile) browser. It can also synchronize with [[Features/Desktop]] installations. Use this guide when you operate the Server yourself. People joining an existing Server only need its address and an account.

# Install and create a space
Choose [[Administration/Server/Docker|Docker]] or the [[Administration/Server/Server Binary|standalone binary]]. Start with an empty data folder and open the Server’s address in a browser. The setup wizard creates your first administrator account and space. [[Dashboard]] explains how to manage additional spaces afterward.

The data folder holds Server configuration and, by default, space folders. Keep it on persistent storage so restarting or replacing a container does not discard it.

# Make it reachable
To reach the Server from another device, follow [[Administration/Server/Network and Internet]]. Configure [[Authentication]] and [[TLS]] before exposing a private space over the internet.

Open the address from the other device and verify that the intended account can access the intended space. For a team, [[Collaboration]] covers shared editing and access. To let visitors read a space without editing it, use [[Publishing]].

# Configure the Server
Manage spaces and accounts through the [[Dashboard]]. Use [[Administration/Server/Configuration]] for process settings such as the listening address and port. [[Administration/Server/Configuration#Data folder]] describes what the data folder holds.

Editor preferences and space behavior are configured separately through [[Workbench/Configuration]]. Server administrators should also understand [[Security]] before granting write access or enabling capabilities for a space.

# Upgrades
Follow the upgrade instructions for your installation: [[Administration/Server/Docker#Upgrading|Docker Compose]], [[Administration/Server/Docker#Upgrades|plain Docker]] or [[Administration/Server/Server Binary#Upgrading|the binary]]. Back up the data you need before upgrading and check that your spaces open afterward.

# Recovery and troubleshooting
Back up your space files and test restoration. For a full Server restore, preserve configuration and authentication state as well as page and attachment files.

If a space will not open or save, check [[Log]] and [[Troubleshooting]]. Distinguish a Server problem from a browser’s offline copy before resetting client storage: a reset can discard edits that have not reached the Server.

# In this section
* [[Administration/Server/Docker]], [[Administration/Server/Server Binary]] and [[Administration/Server/Server Deployment]] — installing and deploying the Server.
* [[Administration/Server/Network and Internet]] and [[Administration/Server/TLS]] — reaching the Server and securing the connection.
* [[Administration/Server/Authentication]], [[Administration/Server/Account]], [[Administration/Server/Single Sign-On]], [[Administration/Server/Authentication Proxy]] and [[Administration/Server/Authelia]] — accounts and sign-in.
* [[Administration/Server/Dashboard]] and [[Administration/Server/Configuration]] — managing spaces and process settings.
* [[Administration/Server/Security]], [[Administration/Server/Security Profiles]], [[Administration/Server/Client Encryption]] and [[Administration/Server/Zero Tracking]] — trust, capabilities, encryption and telemetry.
