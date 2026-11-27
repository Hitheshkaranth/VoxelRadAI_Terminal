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
  inference quota for the bootstrap administrator and for bridged reads.
- `BRIDGE_SECRET` (optional): lets radgenis.com send reads to this Space. See
  [Bridge for radgenis.com](#bridge-for-radgeniscom-vercel).
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`: initial administrator.
- `SARVAM_API_KEY` (optional): enables hands-free report dictation. Audio is sent from
  the API to Sarvam AI's speech-to-text service (`saaras:v4`); the key never reaches
  the browser. Without it the report panel shows dictation as unavailable.
- `DATABASE_URL` (recommended): an external PostgreSQL database for durable accounts
  and saved studies. Without it, a loopback PostgreSQL instance is initialized in
  `/tmp` and backed up every five minutes (and at shutdown) to the private dataset
  `<owner>/VoxelRad-state`, then restored at the next start. Accounts, templates and
  server-saved studies therefore survive restarts; changes made in the last few
  minutes before an abrupt stop can be lost. Sign-in sessions are not backed up, so a
  session revoked after the last backup cannot return and users sign in again after a
  restart; set `STATE_BACKUP_SESSIONS=on` to keep logins across restarts and accept
  that risk. The restore runs in a single transaction. If it fails (as opposed to no
  backup existing yet), the Space starts with an empty database and **does not upload
  backups**, so the last good backup is not overwritten. The pause is recorded in
  `/tmp/skanda-postgres/.restore-failed`, so it also survives a process restart (when the
  database already exists and no restore is attempted); fix the cause, or set
  `STATE_BACKUP_ALLOW_FRESH=1` to start fresh, clear the marker and replace the backup. Set `STATE_BACKUP=off`
  to disable the backup. The backup contains account password hashes and any
  server-saved study data, so keep the dataset private.
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

### Bridge for radgenis.com (Vercel)

The Vercel deployment has no GPU. It can send Skanda V1 reads to this Space through a
shared secret instead of a Space sign-in:

1. Generate a secret of at least 32 characters, for example `openssl rand -base64 48`.
2. In the Space settings, add it as the secret `BRIDGE_SECRET` and make sure `HF_TOKEN`
   belongs to the PRO owner account. Restart the Space.
3. Configure the Vercel side as described in [vercel.md](vercel.md#hosted-skanda-v1-reads-through-the-space).

Requests to `/lmstudio/*` and `/gradio_api/*` that carry `X-VoxelRad-Bridge: <secret>`
(compared in constant time) skip the Space session check. With the header absent or
wrong, nothing changes: callers still need a Space session. Bridged reads always use
the owner `HF_TOKEN` quota path above. The secret itself is never forwarded: the gateway
submission and the loopback result stream carry a random per-process token
(`X-VoxelRad-Gateway`, accepted only on `/gradio_api/*`) instead. The gateway is this Space's
own public host, taken from `SPACE_HOST` (set by Hugging Face); set `OWNER_GATEWAY_HOST` to
override it. Only `*.hf.space` hosts are accepted, because the owner `HF_TOKEN` is sent there;
with no valid host, reads fall back to the visitor quota path. The calling site adds
`X-VoxelRad-User`, a keyed pseudonym of its account id; the Space only writes it to the
log (`Skanda read requested by bridge (u-…), owner quota`). It never receives emails,
names or session cookies from the site. Leaving `BRIDGE_SECRET` unset (or shorter than
32 characters) turns the bridge off.

Quota caveat: every radgenis.com user shares the owner's ZeroGPU PRO quota. Each
read reserves about 90 quota seconds whatever the image, so a few hundred reads can
use a day's allowance. Whole-volume jobs send one read per sampled slice and are
expensive; one CT volume can cost as much as dozens of radiograph reads. The site
caps reads per user per UTC day (`MODEL_DAILY_READS`), but the cap is per user, not
per site, so watch the quota page on Hugging Face. When the quota runs out, every
bridged read fails with a quota message until it resets. Rotate the secret on both
sides if it leaks.

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

Off by default. It runs only when the operator sets `TRAINING_CAPTURE=on` **and** a private
`TRAINING_PSEUDONYM_SECRET` (a long random value; without it capture stays off and the server
logs why), **and** the signed-in user has turned on "Share de-identified cases" under
Settings → Data & storage. Users can withdraw at any time; that stops future capture, and
records already kept stay until the retention period ends. Captures for a server study are
accepted only from its owner, and pseudonyms include the user ID so one account cannot attach
records to another's.

For each analysed image the server keeps a de-identified JPEG (pixels only, long side at most
2048 px) with the AI findings. Pixels are kept only for DICOM images whose Burned In Annotation
(0028,0301) is explicitly NO. Images where it is YES, where the tag is missing (common for
ultrasound, secondary captures, XA, endoscopy, microscopy and CR/DX screenshots, so a missing tag
is treated as unknown, not as NO), and PNG/JPEG uploads are captured as text only. Slices of NRRD
volumes are kept as read; slices of volumes built from a DICOM series only when every slice
declares NO. At
sign-off it keeps the radiologist's accept/dismiss decisions and the AI draft beside the
signed report text. Dictation phrases that fail, return nothing, are undone ("scratch
that") or are later corrected are kept with their audio and the corrected text.

Patient name, ID, referring physician, contact details and full dates are removed and
study, image and user IDs are replaced with keyed one-way pseudonyms. Only an age band
and sex are kept. Free text is also scrubbed of labelled names ("Patient:", "Name:"), MRN-like
tokens, phone numbers, Aadhaar-like 12-digit numbers and PIN codes after address words. Burned-in
text is not removed from images that are sent. Records are deleted from the
database after `TRAINING_RETENTION_DAYS` (default 365).

On the Space, captured records are also copied every five minutes (and at shutdown) to a
**private** Hugging Face dataset, `<owner>/VoxelRad-training` by default (override with
`TRAINING_DATASET_REPO`), using the Space's `HF_TOKEN`. This keeps the data when the
temporary database is reset. Records are marked synced only after a successful upload, and
the sync stops if the dataset is not private. Volume (CT/MRI) reads capture every slice with
findings plus every tenth clean slice. Administrators can list and export them at
`/api/admin/training/summary`, `/api/admin/training/cases`, `/api/admin/training/images/<sha256>`,
`/api/admin/training/dictation` and `/api/admin/training/dictation/<id>/audio`.
Users see what is captured under Settings → Data & storage. Obtain the consent or ethics
approval your jurisdiction requires before using captured data for training.
