SilverBullet (in multi-server mode) supports SSO via OpenID Connect (OIDC). Administrators provision accounts individually and assign them to spaces. Local username/password accounts remain available alongside SSO accounts.

## Connect a provider
1. Sign in as a local administrator and open **Admin → Authentication** in the Space Manager.
2. Choose Google Workspace or OpenID Connect.
3. The central login origin comes from **Admin → Server** when a primary URL is configured.
4. Copy the displayed callback URL into the provider's client configuration. The path is `/.auth/central/oidc/callback`; each space does not need a separate provider callback.
5. Enter the issuer URL, client ID and client secret. Save and test sign-in, then finish provider sign-in in the test window.
6. Review the returned identity and enable SSO. The test does not create an account or replace your administrator session. Changing a draft requires another successful test before activation.

Keep at least one working local administrator for recovery. Client secrets are stored in the server root's `authentication.json`. Protect and back up this file together with `users.json` and the server’s authentication state.

### Google Workspace
Create a **Web application** OAuth client in Google Cloud, configure its consent audience for your organization, and register the exact callback shown by SilverBullet. Enter your Workspace domain in the wizard. SilverBullet checks the signed `hd` organization claim and requires a verified email, an email suffix alone is not proof of Workspace membership. See [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect).

### OpenID Connect providers
Create a confidential OIDC client, register the displayed callback and enable Authorization Code with PKCE. Use the provider's issuer URL and client credentials. The provider must supply a stable subject and a verified email, using the `openid`, `email` and `profile` scopes.

SilverBullet's provider integration tests use [Pocket ID](https://pocket-id.org/docs/), but the same generic configuration is intended for standards-compliant providers such as [Authentik](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/), [Authelia](https://www.authelia.com/integration/openid-connect/introduction/), [Keycloak](https://www.keycloak.org/securing-apps/oidc-layers), and [ZITADEL](https://zitadel.com/docs/guides/integrate/login/oidc). Provider defaults vary, so verify the required scopes, PKCE support, client authentication method, and `email_verified` claim with the sign-in test before enabling SSO.

The server must reach the issuer’s discovery, authorization metadata, token and key endpoints. A private certificate authority can be supplied with `SB_OIDC_CA_FILE`, pointing to a PEM certificate trusted for provider connections. Certificate verification remains enabled.

## Add users
Open **Users → Add user**, choose SSO, enter the expected email, and review the suggested username. Assign the user to the required spaces. Successful first sign-in binds the account to the provider's issuer and subject. Later sign-ins use that binding, so a provider email change does not silently move the account to someone else.

SSO does not automatically enroll unknown users or attach an identity to a local account with the same email. Users without space membership cannot access private spaces. Disable a user to revoke their access. Replacing the provider requires explicit review and may require reprovisioning SSO accounts.
