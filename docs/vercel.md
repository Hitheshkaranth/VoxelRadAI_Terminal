# VoxelRad AI on Vercel

Production identity: **VoxelRad AI**, intended domain **voxelradai.com**. The existing repository name and persisted storage keys remain compatible; Skanda still names a supported inference model, not this application.

## Required architecture

Vercel serves the authenticated React frontend. A separately hosted HTTPS backend serves the existing API/PostgreSQL deployment and authenticated model proxies. Do not deploy the default local-only frontend as the production site: sign-in is required for launch. No authentication is simulated in the browser.

Set the backend's PUBLIC_ORIGIN to `https://voxelradai.com`, configure production TLS and credentials, and verify `/healthz`. The backend edge must serve `/api/*` and enforce session authentication for `/lmstudio/*`, `/txrv/*` and `/maira/*`, as the bundled Nginx configuration does. Vercel forwards these routes through external rewrites so browser sessions stay same-origin. Do not rewrite directly to an unauthenticated model engine. Keep callback query strings out of access/error logs on every proxy.

## Build and deploy

1. Authenticate the official Vercel CLI to your account: `npx vercel login`.
2. Set `VOXELRAD_BACKEND_ORIGIN` in your terminal to the backend's HTTPS origin. This is configuration, not a secret.
3. From the repository root run `node scripts/prepare-vercel.mjs`. It checks backend health and anonymous session behavior, forces `VITE_SERVER_MODE=true`, and creates a fresh isolated deployment directory containing only built assets and routing configuration.
4. In the printed directory run `npx vercel --prod --yes --name voxelradai`. Select the intended Vercel account/team if prompted.
5. Add `voxelradai.com` to that Vercel project and apply the exact DNS records Vercel supplies at your registrar. Do not replace unrelated MX/TXT records. Verify the domain and TLS before directing users there.

Set the Keycloak callback to `https://voxelradai.com/api/oidc/callback` when enabling SSO. Configure S3 CORS for the same origin. Preview-domain login will deliberately fail origin validation unless a separate preview backend is configured for that exact preview origin. Do not weaken the production origin check for previews.

## Acceptance before launch

Verify anonymous users cannot open account data, sign-in/logout/revocation, recovery, model-proxy authentication, and enabled storage/PACS flows on the actual domain. Confirm cookie attributes, real-provider callbacks, upload limits and long inference timeout behavior through Vercel. Independent clinical validation is still outstanding. Existing source release archives retain their historical product name; they are not replaced by rebranding main.
