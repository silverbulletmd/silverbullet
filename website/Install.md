There’s a progressive path in how people tend to install and deploy SilverBullet. Generally, it’s best to try it out on your local machine first. Play around a bit, see if it’s for you.

Once you’re hooked, you may want to spend a bit more time and host SilverBullet on a server in your local network or on the public Internet.

# Cloud hosted
While [[Self Hosted]] is the intended path, if this is too much hassle for you. There is a simpler option by using [PikaPods](https://www.pikapods.com/pods?run=silverbullet). For a small fee (about $1.50 per month and you get $5 in credit signing up, so the first months are _free_), you can run your instance there. PikaPods handles deployment, upgrades and backups and exposes SilverBullet securely via TLS.

# Self hosted
Installing SilverBullet as a (local) web server is pretty straightforward if you’re technically inclined enough to be able to use a terminal.

The basic setup is simple: you run the SilverBullet server process on your machine, then connect to it locally from your browser via `localhost`.

You have two options:

1. Installation via [[Install/Docker]] (the awesome container runtime): recommended if you already have Docker installed
2. Installation of the single [[Install/Binary]] distribution (available for all major platforms)

# Network and Internet access
Once you got a comfortable set running locally, you will have to look at options to expose your setup to your [[Install/Network and Internet]].
