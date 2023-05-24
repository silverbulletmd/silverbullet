You can deploy SilverBullet to [Deno Deploy](https://deno.com/deploy) for free, and store your data (space) in an S3 bucket.

This guide assumes you know how to set up the S3 bucket part and get appropriate IAM keys and secrets to access it.

For the Deno Deploy side:

Sign up for a (free) [Deno Deploy account](https://dash.deno.com/projects) and create a project there.

Set these environment variables in the project:

* AWS_ACCESS_KEY_ID
* AWS_SECRET_ACCESS_KEY
* AWS_BUCKET (e.g `my-sb-bucket`)
* AWS_ENDPOINT (e.g. `s3.eu-central-1.amazonaws.com`)
* AWS_REGION (e.g. `eu-central-1`)
* SB_FOLDER (should be `s3://`)
* SB_PORT (should be `8000`)
* SB_USER (e.g. `pete:letmein`) — this is **super important** otherwise your space will be open without any authentication

In your local environment set `DENO_DEPLOY_TOKEN` to your account’s  [deploy token](https://dash.deno.com/account#access-tokens).

Install [deployctl](https://deno.com/deploy/docs/deployctl).

Then run:

```shell

deployctl deploy --prod --include= -p your-project https://silverbullet.md/silverbullet.js
```

And that’s it!