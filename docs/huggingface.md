# Skanda V1 on Hugging Face Spaces

The full application source is mirrored into the private model repository at
`hitheshkaranth/Skanda-V1/application/` and deployed to the public Space
[`hitheshkaranth/VoxelRad`](https://huggingface.co/spaces/hitheshkaranth/VoxelRad).
The Skanda V1 model repository and weights remain private.

The Space uses Gradio and `spaces.GPU(size="xlarge", duration=45)` for the bf16
reader. ZeroGPU's default 48 GB allocation is too small; the 96 GB allocation
is required. Requests queue and consume the visitor's GPU quota. Whole-volume
jobs make many requests and can exhaust that quota. A live chest X-ray read
passed on 16 November 2026; see the [deployment verification](validation/2026-11-16-huggingface-zero-gpu.md).
This verifies operation, not clinical accuracy or every modality.
The 45-second request reserves 90 quota seconds on `xlarge`, keeping the request
below anonymous visitors' per-task limit. A previous 120-second setting worked
with the owner's Hub token but failed from an ordinary browser visitor session.
The full reservation must fit within the remaining daily allowance. For example,
36 quota seconds left cannot start a 90-second reservation. A successful sign-in
to VoxelRad does not grant extra Hugging Face quota. The error screen distinguishes
this provider refusal from an unloaded or unreachable model. Drafting a report
from existing findings does not need an additional GPU request.

The React application, Node API and PostgreSQL run on the CPU. The same-origin
model facade forwards Hugging Face request headers to Gradio's queued API so
GPU requests retain the visitor context. The model is placed on CUDA at module
startup, as required by ZeroGPU, and only read operations are GPU-decorated.
The pinned Gradio app runs through `Blocks.launch()` so ZeroGPU can pack tensors
and register GPU functions through its standard startup hook. Node SSR is disabled
because the existing React application provides the pages.

## Configuration

Set these Space secrets:

- `HF_TOKEN`: permission to read the private model repository; also authenticates
  inference quota for the bootstrap administrator only.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`: initial administrator.
- `SARVAM_API_KEY` (optional): enables hands-free report dictation. Audio is sent from
  the API to Sarvam AI's speech-to-text service (`saaras:v4`); the key never reaches
  the browser. Without it the report panel shows dictation as unavailable.
- `DATABASE_URL` (recommended): an external PostgreSQL database for durable accounts
  and saved studies. Without it, a loopback PostgreSQL instance is initialized in
  `/tmp`; **accounts and server-saved studies are lost when the Space restarts**.
  Browser-local studies retain their existing browser storage behavior.

### Connect Neon PostgreSQL

Hugging Face Spaces only permits outbound ports 80, 443 and 8080, so a normal
PostgreSQL connection on port 5432 will not work. Use Neon's WebSocket driver:

1. Create a Neon project and copy its connection string from **Connect**.
2. In the VoxelRad Space's **Settings → Variables and secrets**, add a **Secret**
   named `DATABASE_URL` containing the full PostgreSQL connection string.
3. Add a **Variable** named `DATABASE_DRIVER` with value `neon`.
4. Restart the Space. The application applies its migrations and bootstraps the
   administrator from the existing secrets if the database is empty.
5. Sign in, open **Settings → Saved studies**, and select **Save current study**.
   Reload and restore it to verify persistence. Automatic saving is not enabled.

The default `DATABASE_DRIVER=postgres` retains the existing native driver for
local PostgreSQL. Live Neon connectivity still needs verification against your
configured database. No provider database or credentials are shipped.

References: [Spaces networking](https://huggingface.co/docs/hub/spaces-overview#networking),
[Neon serverless driver](https://neon.com/docs/serverless/serverless-driver).

`PUBLIC_ORIGIN` is derived from `SPACE_HOST` unless explicitly supplied.
`MODEL_REVISION` pins the weights and inference code to one model commit.
`VITE_MODEL_ID=skanda-v1` is applied when building the uploaded web bundle.

The Space is public and requires application sign-in for inference. Optional Keycloak, S3,
Orthanc, MAIRA-2 and TorchXRayVision integrations require their own configured
services, just as in the original deployment.

### Administrator PRO quota

Reads from the administrator whose email matches `BOOTSTRAP_ADMIN_EMAIL` use the
server-held `HF_TOKEN` through the public HF queue gateway. The gateway attaches
the authenticated account's ZeroGPU identity. A localhost-only call cannot turn
a bearer token into that signed identity. The token is never sent to the browser.
Other administrators and clinicians retain their visitor quota; there is no
automatic fallback to owner quota for those accounts. Queue result headers expose
only `X-Voxelrad-Quota-Identity: owner` or `visitor`, never credentials.

Verify with `python deploy/huggingface/status.py --read --browser-quota`: this
removes client-side HF authentication before the read and exercises the server's
owner connection using only the application session. PRO quota remains finite;
the 96 GB allocation reserves 90 quota seconds for a 45-second read.

Queue result waiting has a 180-second wall-clock deadline, independent of SSE
heartbeats. Timeout, disconnect and browser cancellation clean pending Gradio
events so abandoned reads cannot accumulate. PRO-authenticated queue submission
uses HF's gateway; result streaming stays on loopback. Administrator-only
`/lmstudio/status` (`status.py --queue`) reports pending/active counts and queue
worker task names without exposing images, prompts or credentials.

## Publish

Install `huggingface_hub` and authenticate with `hf auth login`. Build the web
application with `VITE_SERVER_MODE=true VITE_MODEL_ID=skanda-v1 npm run build --prefix app`.
Run `python deploy/huggingface/publish.py` to prepare the source snapshot and
publish the application to the model repository and Space. This creates a public
ZeroGPU Space and stores bootstrap credentials in ignored `output/huggingface/`.
It does not request a dedicated paid GPU.

## Report templates and dictation

Each signed-in user keeps their own report templates on the server (`report_templates`
table): letterhead logo, institution, department, address lines, footer text, page
numbers and section titles, plus one default. Printed and PDF reports use the report's
chosen template or the user's default. Templates are stored in PostgreSQL, so on the
ephemeral loopback database they are lost on restart like other server data; set
`DATABASE_URL` to keep them.

Report sections are rich-text editors (bold, italic, underline, subheadings, lists).
Formatting is sanitized to a fixed set of tags with no attributes; the plain-text
version stays the source for sign-off checks, exports and sharing.

Hands-free dictation listens continuously, sends each phrase after a pause (Sarvam's
REST limit is 30 seconds per request) and understands voice commands: "next section",
"previous section", "go to impression", "new line", "bullet point", "numbered list",
"scratch that" and "stop dictation". Signing always requires a click.

## Model-improvement capture

On by default (`TRAINING_CAPTURE=on`). For each analysed image the server keeps a
de-identified JPEG (pixels only, long side at most 2048 px) with the AI findings; at
sign-off it keeps the radiologist's accept/dismiss decisions and the AI draft beside the
signed report text. Dictation phrases that fail, return nothing, are undone ("scratch
that") or are later corrected are kept with their audio and the corrected text.

Patient name, ID, referring physician, contact details and full dates are removed and
study, image and user IDs are replaced with keyed one-way pseudonyms. Only an age band
and sex are kept. Burned-in text on images is not removed. Records are deleted after
`TRAINING_RETENTION_DAYS` (default 365). Administrators can list and export them at
`/api/admin/training/summary`, `/api/admin/training/cases`, `/api/admin/training/images/<sha256>`,
`/api/admin/training/dictation` and `/api/admin/training/dictation/<id>/audio`.
Users see what is captured under Settings → Data & storage. Obtain the consent or ethics
approval your jurisdiction requires before using captured data for training.
