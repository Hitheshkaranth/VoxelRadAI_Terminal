# VoxelRad AI on Vercel

Production: https://voxelradai.com. The private GitHub repository remains named `Hitheshkaranth/skanda-radiology`.

## Architecture

Vercel serves the React app and the same-origin Node API in `api/index.mjs`. Neon PostgreSQL stores accounts, sessions and saved studies. The root build forces authenticated server mode; production does not bypass sign-in. Database migrations are bundled with the function and checked on initialization.

Production environment variables are managed in Vercel: `DATABASE_URL`, `PUBLIC_ORIGIN=https://voxelradai.com`, and `DB_POOL_SIZE=3`. Never commit credentials or local environment files. The frontend and API use the Singapore region. Cookie and origin validation require the canonical production domain; preview authentication needs a separately configured origin and database.

## Deployment

Install the Vercel GitHub app for the private repository, connect it to the `voxelradai` Vercel project, and select `main` as the production branch. This grants repository access without making the repository public. Once connected, pushes to main build with the root `vercel.json` and deploy to the custom domain. Until the connection is authorized, deploy from the repository root with `npx vercel deploy --prod`.

The root build installs app dependencies, compiles TypeScript and builds the authenticated frontend. Hosted study uploads are limited to 4 MB to fit the serverless request limit; the Docker API supports 25 MB. GPU inference, SSO, private object storage and PACS remain disabled until separately configured. Serverless instances do not run the Docker process's hourly cleanup timer; instead about 2% of requests schedule the same cleanup (expired sessions, limiter rows, recovery codes and abandoned uploads) after responding, through `waitUntil`. The API trusts Vercel's `X-Real-IP` for per-client sign-in limits. Responses carry a Content-Security-Policy and `Cross-Origin-Opener-Policy: same-origin` from `vercel.json`; a remote model host must be HTTPS (or localhost) to pass `connect-src`. Vercel Web Analytics is wired in through `@vercel/analytics` (cookieless; the page URL is sent without its query string or hash). It records page views plus custom events. The visitor funnel is: landing page view → `demo_open` (the `/demo` workspace) or `demo_play` (video) → `access_request` (form submitted) or `model_download` (Skanda-0 build and link). Supporting events: `demo_cta`, `access_cta`, `open_models`, `model_card_open`, `benchmark_tab`, `cite_copy` and `profile_open`. `/demo` is a public, account-free workspace seeded from `app/public/demo/cases.json` (regenerate with `python3 app/scripts/build-demo-cases.py`); it makes no API or model calls. Enable it under the project's Analytics tab; custom events need a Pro plan.

## Hosted Skanda V1 reads through the Space

Vercel has no GPU. When configured, `/lmstudio/v1/chat/completions` and the model-list
paths are forwarded by the API function to the Hugging Face ZeroGPU Space
`hitheshkaranth/VoxelRad`, which runs Skanda V1. Without the two settings below, those
paths answer exactly as before (the `unconfigured-model` route: sign-in required, then
not found), so nothing changes until both are set.

1. Set up the Space side first: add `BRIDGE_SECRET` to the Space (see
   [huggingface.md](huggingface.md#bridge-for-voxelradaicom-vercel)).
2. In the Vercel project, add these Production environment variables:
   - `MODEL_UPSTREAM_URL=https://hitheshkaranth-voxelrad.hf.space/lmstudio` (HTTPS only;
     no trailing `/v1`).
   - `BRIDGE_SECRET`: the same value as on the Space, at least 32 characters.
   - `MODEL_DAILY_READS` (optional, default `40`): reads per user per UTC day. `0` turns
     hosted reads off without removing the bridge.
   - `VITE_MODEL_ID=skanda-v1`, so new browsers select the Space's model by default.
     Existing users can pick `skanda-v1` in Settings; the model URL stays `/lmstudio/v1`.
3. Enable **Fluid compute** for the project (Settings → Functions). The function streams
   the read for up to 180 seconds of queue and GPU time; `vercel.json` sets
   `maxDuration` to 300 seconds. Fluid compute is required: without it the plan's function
   limit can be lower than 300 seconds and long reads are cut off. The proxy ends a read
   itself at 280 seconds with a clear error, before the platform would kill it.
4. Redeploy. Sign in on voxelradai.com, open Settings and check the connection; it should
   report `skanda-v1` as loaded.

How it works: the browser calls the same origin, so the Content-Security-Policy needs no
change. The API requires a signed-in session, counts the read in the existing limiter
table (`login_attempts`, keyed by a hash of the user id; no migration), then calls the
Space with `X-VoxelRad-Bridge` and a keyed per-user pseudonym in `X-VoxelRad-User`.
Emails, names and the site's session cookie are never sent to the Space. The response is
streamed through without buffering, and closing the tab or cancelling aborts the upstream
read so its queue slot is released. Reads that fail before reaching the GPU (Space
asleep, queue unavailable, quota refused) are not counted. Errors come back as the JSON
`{ error }` the workspace already shows: quota refusals as HTTP 429 with the ZeroGPU
quota text, an unreachable or building Space as 503, a Space that does not start the read
within 60 seconds as 504, and a wrong secret as 502.

Quota caveat: every voxelradai.com user spends the Space owner's ZeroGPU PRO quota. Each
read reserves about 90 quota seconds; whole-volume (CT/MR) jobs send one read per sampled
slice and can use the daily quota quickly. The per-user daily cap limits one account, not
the site. When the quota runs out, all hosted reads fail with a quota message until it
resets. Model output remains candidate findings for review.

## Verification

Check `/healthz`, anonymous session state, rejection of anonymous study access, sign-in/logout, recovery and role restrictions on the production domain after deployment. The server and app test suites run with `npm test`. Provider-specific flows need verification when enabled.

`scripts/prepare-vercel.mjs` remains an alternative packaging helper for a separately hosted HTTPS backend; it is not used by the current same-project deployment.
