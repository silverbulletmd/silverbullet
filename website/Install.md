There’s a progressive path in how people tend to install and deploy SilverBullet. Generally, it’s best to try it out on your local machine first. Play around a bit, see if it’s for you.

Once you’re hooked, you may want to spend a little bit more time and host SilverBullet on a server in your local network or on the public Internet. SilverBullet is not available as a SaaS product, so you’ll have to self host it.

# Installation options
Installing SilverBullet as a (local) web server is pretty straightforward if you’re technically inclined enough to be able to use a terminal.

The basic setup is simple: you run the SilverBullet server process on your machine, then connect to it locally from your browser via `localhost`.

You have a few options here:

1. Installation via [[Install/Docker]] (the awesome container runtime): recommended if you already have Docker installed
2. Installation via [[Install/Deno]] (the awesome JavaScript runtime): recommended if you intend to hack on SilverBullet itself later on
3. More advanced: deploy directly to the cloud via [[Install/Deno Deploy]]

# Non-local access
Once you got a comfortable set running locally, you may want to look at options to expose your setup to your [[Install/Network and Internet]].
