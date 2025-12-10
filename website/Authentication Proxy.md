In case you would like to run SilverBullet behind an authentication proxy (such as Authelia, Authentik or the ones integrated with Cloudflare Zero Trust or Pangolin) there is one key configuration tweak you need to make:

**You must exclude a few paths from authentication**. If you don’t do this a lot of PWA functionality may not work and SilverBullet may break in unexpected ways. Doing this is perfectly safe, it just gives browsers unauthorized access to some client code, not any of your content.

In your configuration add **rules to allow unauthenticated access** for the following paths:

* `/service_worker.js`
* `/.client/*`
