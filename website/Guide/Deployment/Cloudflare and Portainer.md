In this guide we will show you how to deploy silverbullet and cloudflare in containers, making them "talk/communicate" in the same private network just for them.

This guide assumes that you have already deployed Portainer. If not, see [this official guide](https://docs.portainer.io/start/install-ce/server/docker/linux) from Portainer to deploy it on Linux.

### Brief

This guide will be divided into three parts, in the first we'll set up Silverbullet with Cloudflare. In the second, we will set up Cloudflare from the beginning to access Silverbullet from outside our LAN using [Tunnels](https://www.cloudflare.com/products/tunnel/). And in the third step, we protect our Silverbullet instance with [Access Zero Trust](https://www.cloudflare.com/products/zero-trust/access/) for authentication.

# 1 - Deploy Silverbullet and Cloudflare in Portainer

## Prepare the Template
We will prepare a template in Portainer where we will add the configuration of a ==docker-compose.yaml== that will run our containers, and we will be able to move the stack to another server/host if necessary using the same configuration.

First, go to **Home** > (Your environment name, default is **local**) > **App Templates** > **Custom Templates** and click on the blue button in the right corner > "**Add Custom Template**".
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-custom-template.png)

### Name

Choose a name for the silverbullet stack, we chose "**silverbullet-docker**", very imaginative... 😊.

### Description

Fill the description with your own words; this is up to you because it is optional.

### Icon Url

Copy and paste this url to get the icon. ``https://raw.githubusercontent.com/silverbulletmd/silverbullet/main/web/images/logo.ico``

### Platform

Choose Linux

### Type

Standalone

### Build Method

As for the Build method choose “**Web Editor**” and copy-paste this ==docker-compose.yaml== configuration:

```yaml
version: '3.9'
services:
  silverbullet:
    image: zefhemel/silverbullet
    container_name: silverbullet
    restart: unless-stopped
    ## To enable additional options, such as authentication, set environment variables, e.g.
    environment:
      - PUID=1000
      - PGID=1000
      #- SB_USER=username:1234 #feel free to remove this if not needed
    volumes:
      - space:/space:rw
    ports:
      - 3000:3000
    networks:
      - silverbullet

  cloudflared:
    container_name: cloudflared-tunnel
    image: cloudflare/cloudflared
    restart: unless-stopped
    command: tunnel run
    environment:
    # If deploying in to Portainer add your token value here!
    # If deploying manually create a ".env" file and add the variable and the value of the token.
      - TUNNEL_TOKEN=your-token-value-here!
      #- TUNNEL_TOKEN=${TUNNEL_TOKEN}
    depends_on:
      - silverbullet
    networks:
      - silverbullet

networks:
  silverbullet:
    external: true

volumes:
  space:
```

We will replace "your-token-value-here" with a real token value in the next steps.

Once you have this, go to the bottom of the page and click **Actions** > **Create Custom Template**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-custom-template-4.png)

Now we have to build the network before we can deploy it.

**NOTE***: If you got a *Error code 8: Attempt to write a readonly database* when running `docker compose up`.

Ensure that the directory on the host system that is mounted as /space in your container has the correct permissions. For example:

```shell
sudo chown -R 1000:1000 /path/to/space
sudo chmod -R 755 /path/to/space
```

## Create the network for silverbullet

Go to **Home** > **Networks** > **Add Network**.

### Name

Choose "**silverbullet**" because that is the name we are already using in the ==docker-compose.yaml==.

You can leave all the other options by default or change them to suit your network needs.

![](Guide/Deployment/Cloudflare%20and%20Portainer/create-network-1.png)
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-network-2.png)
Click **Create Network** at the bottom of the page.
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-network-4.png)

## Deploying the Stack

Go to **Home** > **Local** > **App Templates** > **Custom Templates**.

Go into the **silverbullet-docker** and click on **Edit**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/deploy-stack-3.png)
Click on **Deploy the stack**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/deploy-stack-2.png)
Give it a few seconds and you will get a notification that both containers are running. 😇

Only the silverbullet container should be working properly by this point, as we haven't finished with Cloudflare yet.
![](Guide/Deployment/Cloudflare%20and%20Portainer/view-containers-1.png)

## Verification

In a web browser in your local network (if your server is in your LAN) write the IP address of your server and add the port 3000 at the end, like this:
``http://your-ip-address:3000 ``

Right now the connection to silverbullet is **HTTP** and PWA([Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)) and offline mode will not work yet. Don’t worry we will get into that later, but for now, it should be working correctly. Try to type something and sync it to your server.

---

# 2 - Set up Cloudflare with Tunnels.

Now we are going to use Cloudflare to be able to connect to SilverBullet from outside our network and have a valid SSL certificate without opening any ports or needing a static IPv4 address from our ISP or changing our router configuration.

You will need three things:

* An account with Cloudflare ☁️.
* A debit/credit card 💳.
* A domain name (you can buy it on [Njalla](https://njal.la/) 😉. Your real name will not be shown if someone uses whois tools).

We assume you've already [signed up to Cloudflare](https://www.cloudflare.com/), if not you can go and do it now. It's free but you'll need to add a real debit/credit card to have access to the tunnels and zero access. If you don't want to do that, you can use **alternatives** like [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) or [Nginx](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) for reverse proxy and [Authelia](https://www.authelia.com/) or you can use the [basic authentication built-in](https://silverbullet.md/Authentication) for authentication.

## Add your Site/Domain Name to Cloudflare

Follow the [official docs](https://developers.cloudflare.com/fundamentals/get-started/setup/add-site/) of Cloudflare on how to add a site, it's really easy, just remember to change the name servers (DNS) to the ones suggested by Cloudflare in the website where you bought your domain name.
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-site-cloudflare-1.png)
Like this (This is Njalla config panel)
![](Guide/Deployment/Cloudflare%20and%20Portainer/create-site-cloudflare-custom_dns.png)

## Setup Tunnel

Without opening any ports or touching the firewall, we set up this tunnel to connect it to our server.

Click on **Zero Trust** once you have added your site/domain name.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnel-1.png)
Click on **Create Tunnel**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-2.png)
Choose a name for your tunnel, I chose "myhome", very imaginative again 😛. And then click on **Save Tunnel**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-3.png)

Since we have already set up a container of Cloudflare, just copy the token you are given. And be careful, if someone gets your token they will be able to make a tunnel connection to your server.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-4_2.png)

Now that you have the token value of your tunnel, it's time to configure the cloudflare container in Portainer. Let's go there.

Go to **App Templates** > **Custom Templates** > **Edit**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/deploy-stack-3.png)
Replace “your-token-value-here!” with your token value.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-6.png)
Click on **Update the template**.****

Next, go to **Stacks** and click on the stack “**silverbullet-docker**”, or the name of your choice, then click **Remove**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/remove-stack-1.png)
Click **Remove** to confirm. Don't worry, this will only remove the stack and the containers attached to it, not the template.
![](Guide/Deployment/Cloudflare%20and%20Portainer/remove-stack-2.png)
Then go to **App Templates**.

Go into the **silverbullet-docker** and click on **Edit**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/deploy-stack-3.png)
Click **Deploy Stack**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/deploy-stack-2.png)
Come back to Cloudflare and in the Connectors section you will see that a connection has been made to your server. Click **Next**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-7.png)
Click **Add a public hostname**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-9.png)
Fill in the **subdomain** field with the name you want to use to access silverbullet. Choose your domain name and for **Type** choose **HTTP** and the **URL** should be **silverbullet:3000**.

![](Guide/Deployment/Cloudflare%20and%20Portainer/setup-tunnels-11.png)
Check now with **silberbullet.your-domain-name.com**. You should be able to access it.

# 3 - Set up Cloudflare Zero Access Trust (Auth).

We assume you've already [signed up to Cloudflare](https://www.cloudflare.com/), if not you can go and do it now, it's free but you'll need to add a real debit/credit card to have access to the tunnels and zero access. If you don't want to do that, you can use **alternatives** like [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) or [Nginx](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) for reverse proxy and [Authelia](https://www.authelia.com/) or you can use the [BasicAuth build-in](https://silverbullet.md/Authentication) for authentication.

Go to **Access** > **Applications** and click **Add an application** from the Zero Trust panel.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-3.png)

Select **Self-Hosted**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-2.png)
Choose a name for your application and use the same name for the subdomain you chose in the previous steps. In our case both are **silverbullet**.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-4.png)
Leave the rest of the page as default and click **Next** at the bottom of the page.

Now it's time to select the name of the policy, the action and the duration of the session.

Select a descriptive **Name** for future troubleshooting, select **Allow** for the **Action** and leave the session duration at its default.

In the **Configure rules** section, select **Emails** if you want to use emails (or you can use a range of IPs, specific countries...) for verification, and enter the emails you want to allow access to Silverbullet.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-5.png)
Leave the rest of the page as default and click **Next** at the bottom of the page.

On the next page, leave everything as default and click on **Add Application** at the bottom of the page.

Go to **silverbullet.your-domain-name.com** and you should see a page like this:
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-6.png)
Going back to the Zero Trust overview, we are now going to create some special rules to allow some specific files from silverbullet without authentication. The same thing happens with other auth applications such as [Authelia](https://silverbullet.md/Authelia).

Create a new self-hosted application in Cloudflare, we suggest the name **silverbullet bypass**.

And add the following **paths**:

```
.client/manifest.json
.client/[a-zA-Z0-9_-]+.png
service_worker.js
```

Leave the rest as default and click **Next** at the bottom of the page.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-7.png)
For the policy name we suggest **silverbullet bypass paths**, as for the **Action** you need to select **Bypass**, and in the Configure Rules **Select** **Everyone** or you can exclude a range of IP's or countries if required.

Leave the rest as default and click **Next** at the bottom of the page.
![](Guide/Deployment/Cloudflare%20and%20Portainer/add-application-clodflare-8.png)
These rules only take effect on the specific paths, you can read more about [Policy inheritance on Cloudflare.](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/)

On the next page, leave everything as default and click on **Add Application** at the bottom of the page.

Go and check your **silberbullet.your-domain-name.com** everything should be working correctly.

Now the connection to silverbullet is **HTTPS** and PWA ([Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)) and offline mode will work.

I hope this guide has been helpful.
