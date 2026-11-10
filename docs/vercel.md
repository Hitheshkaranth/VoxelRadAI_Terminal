# VoxelRad AI on Vercel

Production: https://voxelradai.com. The private GitHub repository remains named `Hitheshkaranth/skanda-radiology`.

## Architecture

Vercel serves the React app and the same-origin Node API in `api/index.mjs`. Neon PostgreSQL stores accounts, sessions and saved studies. The root build forces authenticated server mode; production does not bypass sign-in. Database migrations are bundled with the function and checked on initialization.

Production environment variables are managed in Vercel: `DATABASE_URL`, `PUBLIC_ORIGIN=https://voxelradai.com`, and `DB_POOL_SIZE=3`. Never commit credentials or local environment files. The frontend and API use the Singapore region. Cookie and origin validation require the canonical production domain; preview authentication needs a separately configured origin and database.

## Deployment

Install the Vercel GitHub app for the private repository, connect it to the `voxelradai` Vercel project, and select `main` as the production branch. This grants repository access without making the repository public. Once connected, pushes to main build with the root `vercel.json` and deploy to the custom domain. Until the connection is authorized, deploy from the repository root with `npx vercel deploy --prod`.

The root build installs app dependencies, compiles TypeScript and builds the authenticated frontend. Hosted study uploads are limited to 4 MB to fit the serverless request limit; the Docker API supports 25 MB. GPU inference, SSO, private object storage and PACS remain disabled until separately configured. Serverless instances do not run the Docker process's periodic cleanup timer; scheduled cleanup still needs configuring. Vercel visitor analytics are not enabled.

## Verification

Check `/healthz`, anonymous session state, rejection of anonymous study access, sign-in/logout, recovery and role restrictions on the production domain after deployment. The server and app test suites run with `npm test`. Provider-specific flows need verification when enabled.

`scripts/prepare-vercel.mjs` remains an alternative packaging helper for a separately hosted HTTPS backend; it is not used by the current same-project deployment.
