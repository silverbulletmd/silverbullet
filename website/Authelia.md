How to set up SilverBullet with Authelia

For SilverBullet to work as intended, some files will need to be excluded from your authentication method of choice. These files always need to be accessible, for example for offline or [[PWA]] support.

The files are the following:
- The web manifest
- The app icon
- The service worker

These files can be whitelisted by adjusting your Authelia configuration to something like this:

```yaml
access_control:
  default_policy: deny
  
  rules:
    - domain: silverbullet.yourdomain.com
      resources:
        - '/.client/manifest.json$'
        - '/.client/[a-zA-Z0-9_-]+.png$'
        - '/service_worker.js$'
      policy: bypass
    - domain: yourdomain.com
      policy: two_factor
```

Please adjust this to fit your specific needs. The important part is that the files are associated with `policy: bypass`.
