# Hugging Face ZeroGPU deployment verification

Verified 16 November 2026 against the private Space
`https://huggingface.co/spaces/hitheshkaranth/Skanda-V1`.

- Runtime reported `RUNNING`, current and requested hardware `zero-a10g`.
- Running Space commit: `1a241eecbfd0249b86347e27a702d6bc2dfe421e`.
- Inference code and bf16 weights pinned to model commit
  `18e1cdc4339c24e3e0f038be38c4ae727a1c809f`.
- Startup downloaded and packed 62.6 GB of tensors for ZeroGPU.
- Reader requests specify `size="xlarge"` (96 GB), duration 120 seconds.
- `/` and `/workspace` returned the built React HTML with HTTP 200.
- `/healthz` returned HTTP 200 and the expected model ID.
- `/api/session` returned an unauthenticated session before login.
- Model inventory correctly returned HTTP 401 before login.
- Administrator login returned HTTP 200 and a session cookie.
- Authenticated inventory returned the exact `skanda-v1` model as loaded.
- One real queued chest X-ray read completed with a valid structured report and
  three findings using `app/public/landing/cxr-69598.webp`.

Local checks: existing API and frontend tests passed; the Space facade's six
tests passed (authentication, forwarded visitor identity, completed read,
quota failure, disconnected queue, secure login-cookie forwarding). Production
build passed. Lint returned no errors, with existing React warnings.

Administrator credentials are stored outside version control at
`output/huggingface/admin-credentials.json`, mode 0600, and in Space secrets.
No credentials are included in this report or either repository.

## Limits

The sample read establishes that the application can invoke the bf16 model
through the live ZeroGPU queue. It does not establish diagnostic accuracy,
outline correctness, browser interaction coverage, or whole-volume throughput.
ZeroGPU queues and daily quotas still apply. The deployment uses temporary
loopback PostgreSQL unless `DATABASE_URL` is configured; accounts and saved
server studies are lost on container restart. The administrator is bootstrapped
again from secrets. Optional external integrations require their own services.

The final verification record is uploaded to the model repository only so
recording results does not rebuild the running Space.

## Public VoxelRad browser verification

The Space was renamed to `hitheshkaranth/VoxelRad` and made public, while the
`hitheshkaranth/Skanda-V1` model repository remains private. The existing logo
was added to the Space README and its sharing thumbnail.

The first browser read exposed a quota difference: requesting 120 seconds on
`xlarge` reserves 240 quota seconds and failed for an anonymous Hugging Face
visitor, although the earlier owner's-token API read had passed. The request
duration was reduced to 45 seconds (90 quota seconds).

At Space commit `d59c78506913d29eace48598dd87f801c9bb2048`, a real browser with
an application session and no Hugging Face authorization token imported the
public `cxr-69598.webp`, selected Chest X-ray and ran Analyze All on the one image.
Analysis completed in about 40 seconds. The viewer displayed three candidate
findings and outline overlays. Screenshot: `output/playwright/voxelrad-live-xray.png`
(ignored local output). No findings were accepted or clinically verified.

The optional TorchXRayVision classifier is not deployed; its independent
cross-check reported unavailable (HTTP 405). Two Vercel analytics scripts were
also unavailable on this host; neither blocked the workspace or model read.

The subsequent optional Neon database-driver change passed all 38 API tests.
Its driver loads on the local Node runtime, but a real external database
connection and durable save/restore still require the owner's database URL.

## Settings and quota-independent reports

Settings now has six section navigation buttons, a viewport-bounded dialog,
independent content scrolling and a fixed Done footer. Browser measurements at
1440×900, 1024×768, 768×1024, 390×844, 375×667 and 844×390 found no page or panel
horizontal overflow, and both dialog and footer stayed inside the viewport.

The default report action now assembles an editable draft directly from existing
findings, retaining review labels and excluding dismissed evidence. A browser
check with the backed-up X-ray study created the draft with zero model requests.
Optional model drafting was tested against a simulated ZeroGPU quota error: it
fell back to a findings draft, with no remaining error or running job. Unit tests
also cover unreviewed labels, dismissed recommendations, incomplete image
coverage, source immutability and no false normal conclusion when nothing remains.

The visible test browser's fixed viewport was larger than its physical window;
the replacement visible session uses a native, resizable viewport.

## Administrator PRO quota connection

Space commit `f3a49b54f9e980d503dabfacd43136a85d9a180e` is running.
The bootstrap administrator's reads now use the server-held HF token through
HF's public queue gateway; other app accounts retain visitor quota. Seven facade
tests pass, including owner role/email isolation, unauthenticated rejection,
visitor identity forwarding, and no owner token in the streamed response.

Live account inspection confirmed `hitheshkaranth` is PRO. The authenticated
quota endpoint returned base 2400 seconds and remaining 2267.360446 seconds,
with zero over-quota usage. A read sent with only the VoxelRad login cookie
(no client HF Authorization header) returned HTTP 200 and quota identity `owner`.
It did not emit the old 36-second quota error, but remained pending for ten
minutes without consuming GPU time. The test client was stopped; end-to-end
image inference through this new route is therefore not yet verified. Queue
status showed no waiting app jobs, which does not rule out a running task waiting
for a provider GPU. The owner's browser workspace was restored after restart.
