If you would like to expose your local SilverBullet instance running on your laptop to the wider Internet (so you can access it from other machines, or even outside your home) using [ngrok](https://ngrok.com/) is a simple and free solution.

**Note:** this will require you to keep the machine you’re running SilverBullet **switched on at all times** (or at least when you want access to SB). When you shut it down (or clause the lid), SilverBullet will become inaccessible (unless you use the sync [[Client Modes|client mode]] of course, but then content will only sync when the machine is on).

## Setup
Generally this setup involves a few steps:
1. [[Install]] and run SilverBullet either via Deno or Docker on your local machine
2. Sign up, install and launch [ngrok](https://ngrok.com/) to expose the local port to the Internet
3. Profit

It is **absolutely key** to enable [[Authentication]] on SilverBullet, otherwise anybody who can guess the URL ngrok gives you, and view and edit your files at will (or worse).

Generally the steps are to run SilverBullet (e.g. via Deno) (see [[Install]] for more options) — note the port here (`3000`):

```shell
silverbullet -p 3000 --user mysuser:mypassword path/to/space
```

Then, create a free [ngrok](https://dashboard.ngrok.com/) account, and follow the instructions to download the ngrok client for your platform, and authenticate it (look for the `ngrok config add-authtoken` command).

Then, in another terminal run `ngrok`:

```shell
ngrok http 3000
```

This will give you a `https://xxx.ngrok-free.app` style URL you can open in your browser.

Note that this URL changes every time, which is inconvenient. Therefore it’s **recommended you create a domain** as well (you get 1 for free). Follow the [instructions on the domains page](https://dashboard.ngrok.com/cloud-edge/domains) in the ngrok dashboard on how to do this. Once you created your domain, you can launch `ngrok` as follows:

```shell
ngrok http --domain=your-domain.ngrok-free.app 3000
```

Enjoy!
