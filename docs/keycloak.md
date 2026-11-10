# Optional Keycloak organization sign-in

The adapter is disabled by default. It adds OpenID Connect authorization-code sign-in with PKCE S256, one-time state, a browser-bound HttpOnly flow cookie, nonce, a five-minute authentication-age check, issuer/audience checks and JWKS signature verification using `openid-client`. No ID/access/refresh tokens are stored in browser storage or retained after the callback. Successful provider authentication creates the existing VoxelRad AI session.

## Identity provisioning

Create the VoxelRad AI user through the existing administrator flow first. A signed-in user explicitly links their provider identity by confirming their current VoxelRad AI password and completing provider authentication. The application stores the exact `(issuer, subject)` pair. Email addresses and provider role claims never automatically create, merge, promote or link accounts.

Alternatively an administrator can explicitly provision a mapping with `POST /api/admin/users/:id/oidc`, supplying `{subject,currentPassword}`. The password is the administrator's current VoxelRad AI password. Obtain the exact immutable subject from the configured realm, verify the intended person, and confirm the target VoxelRad AI account before assigning it. An existing mapping cannot be overwritten by this API. Users can explicitly unlink after current-password confirmation; unlinking revokes all local sessions and pending linking flows.

Disabled VoxelRad AI accounts cannot sign in through the provider. A password reset or revoked session during a linking round-trip prevents the pending link from completing. Identity uniqueness is enforced in PostgreSQL. An identity that is not already linked receives a generic refusal rather than automatic account creation.

## Configure an existing HTTPS provider

Create a confidential OpenID Connect client with standard authorization-code flow enabled. Disable direct access/password grants and implicit flow. Set the single valid redirect URI to `https://YOUR_APP_ORIGIN/api/oidc/callback`; do not use wildcard redirects. Set PKCE to S256. Store the client secret with the deployment's secret manager.

Configure the API environment and recreate the API:

```dotenv
OIDC_ENABLED=true
OIDC_ISSUER=https://YOUR_IDENTITY_ORIGIN/realms/skanda
OIDC_CLIENT_ID=skanda-web
OIDC_CLIENT_SECRET=
OIDC_PROVIDER_NAME=Organization sign-in
OIDC_ALLOW_INSECURE_LOCALHOST=false
# Optional exact assurance value; configure the corresponding Keycloak flow first.
OIDC_REQUIRED_ACR=
```

Use the exact issuer identifier from the realm, including any trailing slash; do not supply the `.well-known` discovery URL. The configured `PUBLIC_ORIGIN` determines the callback URL. Missing required configuration fails startup when OIDC is enabled. Provider discovery/network failure fails the organization sign-in flow closed; it does not bypass verification.

If `OIDC_REQUIRED_ACR` is set, the authorization request asks for that assurance and rejects an ID token whose `acr` does not exactly match. This only proves the provider emitted the configured value: the provider's authentication flow must actually require the intended MFA methods. Local password sign-in and administrator recovery remain available. Enforcing organization-wide mandatory MFA requires an explicit local-login/break-glass policy; this adapter does not claim MFA enforcement across every authentication method.

## Optional local development provider

The separate `compose.keycloak.yaml` starts a development provider only when explicitly selected. It uses a named development volume and binds port 8180 to loopback. It is not a production Keycloak installation and has no preconfigured realm, client, user or credentials.

1. Add a unique `KEYCLOAK_ADMIN_PASSWORD` to the ignored environment file. Run `docker compose -f compose.yaml -f compose.keycloak.yaml --profile keycloak up -d keycloak`.
2. Open `http://keycloak.localhost:8180`, sign in with the configured bootstrap administrator and create realm `skanda` plus confidential client `skanda-web`. Configure exact callback `http://localhost:8088/api/oidc/callback` (or the exact loopback `PUBLIC_ORIGIN` in use), standard flow and PKCE S256. Create a test identity.
3. Set `OIDC_ENABLED=true`, the generated `OIDC_CLIENT_SECRET`, and `OIDC_ALLOW_INSECURE_LOCALHOST=true` in the ignored environment file. Set `OIDC_ISSUER=http://keycloak.localhost:8180/realms/skanda`. Recreate the API with both Compose files.
4. Sign in to the local VoxelRad AI account and explicitly link the test identity. Sign out locally, then test organization sign-in.

The `.localhost` hostname must resolve to loopback in the browser; the API override maps it to Docker's host gateway. Do not replace the issuer with a different internal service name: browser and server must agree on the exact issuer. HTTP is accepted only with the explicit development flag **and** loopback/local `.localhost` issuer and application hostnames. Do not use that flag for a remote deployment. The example Keycloak image is pinned to the version shown in the official getting-started guide when this integration was added; review security updates before deploying.

## API and operations

| Endpoint | Behavior |
| --- | --- |
| `GET /api/oidc/config` | Public `{enabled,providerName,requiredAcr}`; never returns a secret |
| `GET /api/oidc/login` | Redirects to the configured provider |
| `POST /api/oidc/link` | Authenticated `{currentPassword}` → `{url}`; navigate the browser to that URL |
| `GET /api/oidc/callback` | One-time callback; redirects to the fixed app root after login/linking |
| `GET /api/oidc/identity` | Authenticated `{linked,issuer?,subject?,linkedAt?}` |
| `DELETE /api/oidc/identity` | `{currentPassword}`; unlinks and revokes local sessions |
| `POST /api/admin/users/:id/oidc` | Explicit administrator mapping `{subject,currentPassword}` |

The flow cookie is SameSite=Lax for the provider's top-level GET callback. The ordinary application session remains SameSite=Strict. Callback state expires after ten minutes and is atomically deleted before token exchange; it cannot be replayed. Pending states are capped at 10,000 globally and expired rows are pruned when a new flow starts. Protect the login endpoint with a trusted ingress abuse policy as well.

Do not log callback query strings: they contain temporary authorization codes and state. Local logout ends the VoxelRad AI session only; provider single logout and back-channel logout are not implemented. A still-valid IdP session may authenticate again without entering a password if its authentication age meets the five-minute bound. VoxelRad AI sessions retain their existing eight-hour absolute expiry; subsequent provider-side account disabling does not automatically revoke an already-issued VoxelRad AI session.

`server/test/oidc.test.mjs` exercises real `openid-client` discovery, PKCE token exchange and signed JWT/JWKS verification against a controlled local standards fixture. It covers invalid state/cookie, expired/replayed flow, PKCE, nonce, issuer, audience, signature, unknown mapping, disabled account and concurrent callback consumption. This is protocol testing, not evidence that a deployment's Keycloak realm or MFA flow has been configured correctly. Run a real-provider acceptance test after supplying domain and credentials.

References: [openid-client discovery](https://github.com/panva/openid-client/blob/main/docs/functions/discovery.md), [authorization-code checks](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md), [Keycloak containers](https://www.keycloak.org/server/containers), [Keycloak Docker quick start](https://www.keycloak.org/getting-started/getting-started-docker).
