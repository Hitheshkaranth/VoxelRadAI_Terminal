"""Full VoxelRad application, with queued ZeroGPU inference."""
import spaces  # Must precede torch and model imports for CUDA emulation.

import atexit
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid
import base64
import hmac
import re
import secrets
import threading

import gradio as gr
import httpx
import torch
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "skanda-v1"
APP_PORT = int(os.environ.get("GRADIO_SERVER_PORT", "7860"))
READ_TIMEOUT_SECONDS = 180
children = []
# Shared only with the local Node API, which hands captured training records to the dataset sync.
TRAINING_SYNC_TOKEN = secrets.token_urlsafe(32)
TRAINING_SYNC_SECONDS = int(os.environ.get("TRAINING_SYNC_SECONDS", "300"))


def start(command, **kwargs):
    child = subprocess.Popen(command, **kwargs)
    children.append(child)
    return child


@atexit.register
def cleanup():
    for child in reversed(children):
        child.terminate()
    for child in reversed(children):
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()


STATE_BACKUP_SECONDS = int(os.environ.get("STATE_BACKUP_SECONDS", "300"))
STATE_FILE = "skanda.sql.gz"
# Training data has its own dataset sync; leave it out of the state backup.
STATE_EXCLUDED_DATA = ("training_cases", "training_images", "dictation_events")
# Sign-in sessions are left out too, so a session revoked after the last backup (sign-out, password change,
# disabled account) cannot come back on restore. STATE_BACKUP_SESSIONS=on keeps logins across restarts instead.
SESSION_TABLES = ("sessions",)
OFF = {"off", "false", "0", "no", ""}


def state_excluded_tables(env=os.environ):
    keep_sessions = env.get("STATE_BACKUP_SESSIONS", "off").lower() not in OFF
    return STATE_EXCLUDED_DATA + (() if keep_sessions else SESSION_TABLES)


def state_dump_args(pg_bin, url, env=os.environ):
    args = [str(pg_bin / "pg_dump"), "--no-owner", "--no-privileges", "-d", url]
    for table in state_excluded_tables(env):
        args += ["--exclude-table-data", table]
    return args


def state_digest(dump):
    """Hash without comments and the per-dump random restrict keys, so an unchanged database is not uploaded again."""
    return hashlib.sha256(b"\n".join(l for l in dump.splitlines() if not l.startswith((b"--", b"\\restrict", b"\\unrestrict")))).hexdigest()


def restore_state(pg_bin, url, fetch, run=subprocess.run, env=os.environ):
    """Load the backup into an empty database. Returns ("restored", digest), ("none", None) or ("failed", None).

    fetch() returns the SQL bytes, or None when no backup exists yet. The restore runs in one transaction,
    so a failure leaves the database empty rather than half-restored."""
    try:
        sql = fetch()
    except Exception as error:
        print(f"State restore failed: {type(error).__name__}.", flush=True)
        return "failed", None
    if sql is None:
        print("No state backup yet; starting empty.", flush=True)
        return "none", None
    result = run([str(pg_bin / "psql"), "-q", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-d", url], input=sql, capture_output=True)
    if result.returncode != 0:
        print(f"State restore failed (exit {result.returncode}).", flush=True)
        return "failed", None
    if "sessions" in state_excluded_tables(env):
        # Older backups included sessions; drop them so a revoked session cannot return.
        run([str(pg_bin / "psql"), "-q", "-d", url, "-c", "DELETE FROM sessions"], capture_output=True)
    print("Restored accounts and saved data from backup.", flush=True)
    # Start from the restored state so the first backup loop does not re-upload (or overwrite) it unchanged.
    return "restored", state_digest(sql)


RESTORE_FAILED_MARKER = ".restore-failed"


def backups_allowed(status, env=os.environ, marker=None):
    """After a failed restore the dataset still holds the last good backup; never overwrite it with an empty database.

    The pause is persisted as `marker` (a file next to the database) so it survives a process restart: on restart the
    database already exists, no restore is attempted (status "existing"), and without the marker the empty database
    would be backed up over the good copy. STATE_BACKUP_ALLOW_FRESH=1 lifts the pause and clears the marker."""
    if status == "failed" and marker is not None:
        try:
            marker.write_text("State restore failed; backups paused until STATE_BACKUP_ALLOW_FRESH=1.\n")
        except OSError as error:
            print(f"Could not record the paused backup state: {type(error).__name__}.", flush=True)
    paused = status == "failed" or (marker is not None and marker.exists())
    if not paused:
        return True
    if env.get("STATE_BACKUP_ALLOW_FRESH", "").lower() in OFF:
        return False
    if marker is not None:
        marker.unlink(missing_ok=True)
    return True


def start_state_backup(pg_bin, url, restore, marker=None):
    """Restore the local database from a private dataset at startup, then back it up when it changes."""
    token = os.environ.get("HF_TOKEN")
    if not token or os.environ.get("STATE_BACKUP", "on").lower() in {"off", "false", "0", "no"}:
        return False
    import gzip
    from huggingface_hub import HfApi, hf_hub_download
    from huggingface_hub.utils import EntryNotFoundError
    try:
        api = HfApi(token=token)
        repo_id = os.environ.get("STATE_BACKUP_REPO") or f"{api.whoami()['name']}/VoxelRad-state"
        api.create_repo(repo_id, repo_type="dataset", private=True, exist_ok=True)
        if api.repo_info(repo_id, repo_type="dataset").private is not True:
            print("State backup dataset is not private; backups disabled.", flush=True)
            return False
    except Exception as error:
        print(f"State backup unavailable: {type(error).__name__}", flush=True)
        return False

    def fetch():
        try:
            path = hf_hub_download(repo_id, STATE_FILE, repo_type="dataset", token=token, force_download=True)
        except EntryNotFoundError:
            return None
        return gzip.decompress(Path(path).read_bytes())

    status, digest = restore_state(pg_bin, url, fetch) if restore else ("existing", None)
    if status == "restored" and marker is not None:
        marker.unlink(missing_ok=True)
    if not backups_allowed(status, marker=marker):
        print("State backups paused so the last good backup is not overwritten. Fix the restore, or set "
              "STATE_BACKUP_ALLOW_FRESH=1 to start a fresh database and replace the backup.", flush=True)
        return False
    last = {"digest": digest}

    def backup():
        dump = subprocess.run(state_dump_args(pg_bin, url), capture_output=True, check=True).stdout
        digest = state_digest(dump)
        if digest == last["digest"]:
            return False
        api.upload_file(path_or_fileobj=gzip.compress(dump), path_in_repo=STATE_FILE, repo_id=repo_id,
                        repo_type="dataset", commit_message="Back up VoxelRad accounts and saved data")
        last["digest"] = digest
        return True

    def loop():
        while True:
            time.sleep(STATE_BACKUP_SECONDS)
            try:
                backup()
            except Exception as error:
                print(f"State backup failed: {type(error).__name__}", flush=True)

    threading.Thread(target=loop, name="state-backup", daemon=True).start()

    def final_backup():
        try:
            backup()
        except Exception:
            pass
    atexit.register(final_backup)
    return True


def start_services():
    """Install the application's supported Node version; start its unchanged API."""
    version = "v24.11.0"
    archive = f"node-{version}-linux-x64.tar.xz"
    node_root = Path(tempfile.gettempdir()) / f"node-{version}-linux-x64"
    if not node_root.exists():
        base = f"https://nodejs.org/dist/{version}/"
        sums = urllib.request.urlopen(base + "SHASUMS256.txt").read().decode()
        expected = next(line.split()[0] for line in sums.splitlines() if line.endswith("  " + archive))
        data = urllib.request.urlopen(base + archive).read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("Node download checksum mismatch")
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as bundle:
            bundle.extractall(tempfile.gettempdir(), filter="data")
    env = {**os.environ, "PATH": f"{node_root / 'bin'}:{os.environ['PATH']}",
           "NODE_ENV": "production", "PORT": "8080", "TRAINING_SYNC_TOKEN": TRAINING_SYNC_TOKEN}
    origin = env.get("PUBLIC_ORIGIN") or f"https://{env['SPACE_HOST']}"
    env["PUBLIC_ORIGIN"] = origin
    if env.get("DATABASE_DRIVER") == "neon" and not env.get("DATABASE_URL"):
        raise RuntimeError("Set DATABASE_URL as a Space secret before enabling DATABASE_DRIVER=neon")
    if not env.get("DATABASE_URL"):
        pg_bin = sorted(Path("/usr/lib/postgresql").glob("*/bin/initdb"))[-1].parent
        pg_dir = Path(tempfile.gettempdir()) / "skanda-postgres"
        # The Gradio SDK may run as root; PostgreSQL must always run unprivileged.
        pg_user = ["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []
        if pg_user:
            pg_dir.mkdir(mode=0o700, exist_ok=True)
            shutil.chown(pg_dir, user="postgres", group="postgres")
        if not (pg_dir / "PG_VERSION").exists():
            subprocess.run(pg_user + [str(pg_bin / "initdb"), "-D", str(pg_dir), "-U", "skanda", "-A", "trust"], check=True)
        start(pg_user + [str(pg_bin / "postgres"), "-D", str(pg_dir), "-h", "127.0.0.1", "-k", tempfile.gettempdir()])
        import psycopg
        created = False
        for _ in range(120):
            try:
                with psycopg.connect("postgresql://skanda@127.0.0.1/postgres", autocommit=True) as db:
                    if not db.execute("SELECT 1 FROM pg_database WHERE datname='skanda'").fetchone():
                        db.execute("CREATE DATABASE skanda")
                        created = True
                break
            except psycopg.OperationalError:
                time.sleep(1)
        else:
            raise RuntimeError("PostgreSQL did not become ready")
        env["DATABASE_URL"] = "postgresql://skanda@127.0.0.1/skanda"
        # Accounts, templates and saved studies survive restarts through a private backup (sessions only if opted in).
        if start_state_backup(pg_bin, env["DATABASE_URL"], restore=created, marker=pg_dir / RESTORE_FAILED_MARKER):
            print("Using local PostgreSQL with a private Hugging Face backup.", flush=True)
        else:
            print("Using ephemeral PostgreSQL: server-saved data is lost on Space restart.", flush=True)
    subprocess.run([str(node_root / "bin/npm"), "ci", "--omit=dev", "--no-audit", "--no-fund"],
                   cwd=ROOT / "server", env=env, check=True)
    api = start([str(node_root / "bin/node"), "src/index.mjs"], cwd=ROOT / "server", env=env)
    for _ in range(120):
        if api.poll() is not None:
            raise RuntimeError("Application API exited during startup")
        try:
            if httpx.get("http://127.0.0.1:8080/healthz").is_success:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError("Application API did not become ready")


@spaces.GPU(size="xlarge", duration=45)
def infer(payload: dict, request: gr.Request):
    print("Skanda GPU task started", flush=True)
    if payload.get("model", MODEL_ID) != MODEL_ID:
        raise gr.Error("Select the skanda-v1 model in Settings.")
    messages = payload.get("messages", [])
    system = " ".join(content_text(m["content"]) for m in messages if m.get("role") == "system")
    image = next((im for im in (content_image(m["content"]) for m in messages if m.get("role") == "user") if im), None)
    tokens = min(max(int(payload.get("max_tokens") or 1024), 1), 1536)
    temperature = float(payload.get("temperature") or 0.0)
    with reader.lock:
        if image is not None and LUNG_PATTERN_MARK in system:
            text, finished = json.dumps({"grade": 0, "evidence": "Skanda reports diffuse findings in its main read."}), True
        elif image is not None:
            ctx = request_ctx(payload, image)
            if ctx and ctx.get("hu") is not None:
                from skanda import ctmri
                image = ctmri.render_ct(ctx["hu"])
            result, raw, finished, _ = reader.read(image, tokens, temperature, ctx=ctx)
            text = json.dumps(result) if result is not None else raw
        else:
            text, finished, _ = reader.chat_text(messages, tokens, temperature)
    print("Skanda GPU task completed", flush=True)
    return {"text": text, "finish": "stop" if finished else "length"}


DATASET_CARD = """---
license: other
private: true
tags: [radiology, medical-imaging, model-feedback, de-identified]
---
# VoxelRad model-improvement data (private)

Captured automatically by the VoxelRad Space for improving future Skanda models.

- `cases/<date>/*.json`: `analysis` records (AI findings for one image or volume slice) and
  `signed` records (radiologist accept/dismiss decisions, AI draft and signed report text).
  `imageSha256` points to `images/<sha256>.<ext>`.
- `dictation/<date>/*.json`: dictated phrases that failed, returned nothing, were undone or
  were corrected, with `audio` pointing to the clip in the same folder.

Patient name, ID, referring physician, contact details and full dates are removed; study,
image and user IDs are keyed one-way pseudonyms; only age band and sex are kept. Text burned
into image pixels and voices in audio are not removed. Use only under the consent or ethics
approval that applies to the source data.
"""
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/webm": "webm",
              "audio/ogg": "ogg", "audio/wav": "wav", "audio/mp4": "m4a", "audio/mpeg": "mp3"}


def sync_training_once(api, repo_id):
    """Copy unsynced captured records to the private dataset; mark them synced only after upload."""
    origin = os.environ.get("PUBLIC_ORIGIN") or f"https://{os.environ.get('SPACE_HOST', 'localhost')}"
    headers = {"x-sync-token": TRAINING_SYNC_TOKEN, "Origin": origin}
    total = 0
    while True:
        batch = httpx.get("http://127.0.0.1:8080/internal/training/batch", headers=headers, timeout=60).json()
        if not batch["cases"] and not batch["dictation"]:
            return total
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for row in batch["cases"]:
                day, stamp = row["created_at"][:10], row["created_at"].replace(":", "").replace(".", "")[:17]
                if row.get("image_b64"):
                    image = root / "images" / f"{row['image_sha256']}.{EXTENSIONS.get(row['mime'], 'bin')}"
                    image.parent.mkdir(parents=True, exist_ok=True)
                    image.write_bytes(base64.b64decode(row["image_b64"]))
                record = {k: row[k] for k in ("kind", "study_ref", "image_ref", "image_sha256", "modality", "model", "payload", "created_at")}
                target = root / "cases" / day / f"{stamp}-{row['kind']}-{row['id']}-{secrets.token_hex(3)}.json"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(record, indent=1))
            for row in batch["dictation"]:
                day, stamp = row["created_at"][:10], row["created_at"].replace(":", "").replace(".", "")[:17]
                name = f"{stamp}-{row['kind']}-{row['id']}-{secrets.token_hex(3)}"
                folder_path = root / "dictation" / day
                folder_path.mkdir(parents=True, exist_ok=True)
                record = {k: row[k] for k in ("kind", "user_ref", "language", "transcript", "corrected", "error", "created_at")}
                if row.get("audio_b64"):
                    audio = f"{name}.{EXTENSIONS.get(row['audio_mime'], 'bin')}"
                    (folder_path / audio).write_bytes(base64.b64decode(row["audio_b64"]))
                    record["audio"] = audio
                (folder_path / f"{name}.json").write_text(json.dumps(record, indent=1))
            api.upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=folder,
                              commit_message=f"Add {len(batch['cases'])} cases and {len(batch['dictation'])} dictation events")
        httpx.post("http://127.0.0.1:8080/internal/training/synced", headers=headers, timeout=60,
                   json={"cases": [r["id"] for r in batch["cases"]], "dictation": [r["id"] for r in batch["dictation"]]}).raise_for_status()
        total += len(batch["cases"]) + len(batch["dictation"])


def start_training_sync():
    """Durable copy of captured data: the Space database may be temporary, the private dataset is not."""
    token = os.environ.get("HF_TOKEN")
    # Mirrors the API: capture is opt-in and needs a private pseudonym key.
    if (not token or os.environ.get("TRAINING_CAPTURE", "off").lower() not in {"on", "true", "1", "yes"}
            or not os.environ.get("TRAINING_PSEUDONYM_SECRET", "").strip()):
        print("Training data sync disabled.", flush=True)
        return
    from huggingface_hub import HfApi
    api = HfApi(token=token)
    repo_id = os.environ.get("TRAINING_DATASET_REPO") or f"{api.whoami()['name']}/VoxelRad-training"
    api.create_repo(repo_id, repo_type="dataset", private=True, exist_ok=True)
    if not api.file_exists(repo_id, "README.md", repo_type="dataset"):
        api.upload_file(path_or_fileobj=DATASET_CARD.encode(), path_in_repo="README.md", repo_id=repo_id, repo_type="dataset",
                        commit_message="Describe the VoxelRad model-improvement dataset")
    if api.repo_info(repo_id, repo_type="dataset").private is not True:
        print("Training dataset is not private; sync stopped.", flush=True)
        return

    def loop():
        while True:
            time.sleep(TRAINING_SYNC_SECONDS)
            try:
                synced = sync_training_once(api, repo_id)
                if synced:
                    print(f"Training sync: {synced} records copied to {repo_id}", flush=True)
            except Exception as error:  # Keep retrying; records stay unsynced until an upload succeeds.
                print(f"Training sync failed: {type(error).__name__}", flush=True)

    threading.Thread(target=loop, name="training-sync", daemon=True).start()
    atexit.register(lambda: sync_training_once(api, repo_id))
    print(f"Training data sync to private dataset {repo_id} every {TRAINING_SYNC_SECONDS} s.", flush=True)


# Register the GPU function before any slow downloads so ZeroGPU detects it at startup.
start_services()
try:
    start_training_sync()
except Exception as error:
    print(f"Training data sync not started: {type(error).__name__}", flush=True)
model_path = snapshot_download(
    os.environ.get("MODEL_REPO", "hitheshkaranth/Skanda-V1"),
    revision=os.environ["MODEL_REVISION"],
    allow_patterns=["code/*", "vlm/*", "skanda_config.json", "skanda_heads.pt", "hint_classifier.pt"],
)
sys.path.insert(0, str(Path(model_path) / "code"))
from skanda.serve import Skanda, content_image, content_text, request_ctx, LUNG_PATTERN_MARK

# ZeroGPU emulates this placement at startup, then grants real CUDA per queued call.
reader = Skanda(model_path)


app = gr.routes.App()


# A trusted RadGenis deployment (radgenis.com on Vercel) may call inference with this shared secret
# instead of a Space session. Unset means the bridge is off. Bridged reads use the owner's quota.
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
if BRIDGE_SECRET and len(BRIDGE_SECRET) < 32:
    print("BRIDGE_SECRET is shorter than 32 characters; bridge disabled.", flush=True)
    BRIDGE_SECRET = ""


# Authenticates this Space's own owner-quota submissions when they come back in through HF's public gateway.
# Random per process: unlike BRIDGE_SECRET it is useless anywhere else, so it may travel upstream.
GATEWAY_NONCE = secrets.token_urlsafe(32)


def owner_gateway_base(env=os.environ):
    """Public queue URL of THIS Space (SPACE_HOST, set by HF), or OWNER_GATEWAY_HOST when given. The owner HF_TOKEN
    goes there, so only an *.hf.space host is accepted; anything else disables the owner-quota path (None)."""
    host = (env.get("OWNER_GATEWAY_HOST") or env.get("SPACE_HOST") or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?\.hf\.space", host):
        return None
    return f"https://{host}/gradio_api/call/read"


def bridge_caller(request):
    """The bridge identity when the request carries the shared secret, else None. Constant-time compare."""
    supplied = request.headers.get("x-voxelrad-bridge", "")
    if not BRIDGE_SECRET or not supplied or not hmac.compare_digest(supplied.encode(), BRIDGE_SECRET.encode()):
        return None
    # Pseudonym from the calling site, for logs only; it never grants anything.
    pseudonym = request.headers.get("x-voxelrad-user", "")
    return {"role": "bridge", "email": "", "bridge": True,
            "pseudonym": pseudonym if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", pseudonym) else "unknown"}


@app.middleware("http")
async def authenticate_inference(request: Request, call_next):
    path = request.url.path
    if path.startswith("/lmstudio/") or (path.startswith("/gradio_api/") and path != "/gradio_api/startup-events"):
        bridged = bridge_caller(request)
        gateway = request.headers.get("x-voxelrad-gateway", "")
        if not bridged and path.startswith("/gradio_api/") and gateway and hmac.compare_digest(gateway.encode(), GATEWAY_NONCE.encode()):
            bridged = {"role": "bridge", "email": "", "bridge": True, "pseudonym": "gateway"}
        if bridged:
            request.state.user = bridged
            return await call_next(request)
        async with httpx.AsyncClient() as client:
            result = await client.get("http://127.0.0.1:8080/api/session",
                                      headers={"cookie": request.headers.get("cookie", "")})
        user = result.json().get("user") if result.status_code == 200 else None
        if not user:
            return JSONResponse({"error": "Sign in to use inference."}, status_code=401)
        request.state.user = user
    return await call_next(request)


@app.get("/healthz")
async def health():
    healthy = all(p.poll() is None for p in children)
    return JSONResponse({"ok": healthy, "model": MODEL_ID, "gpu": "ZeroGPU xlarge (96 GB)"}, status_code=200 if healthy else 503)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def api_proxy(path: str, request: Request):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length", "connection"}}
    async with httpx.AsyncClient(timeout=65) as client:
        result = await client.request(request.method, "http://127.0.0.1:8080/api/" + path,
                                      params=request.query_params, headers=headers, content=await request.body())
    response = Response(result.content, status_code=result.status_code,
                        headers={k: v for k, v in result.headers.items() if k.lower() not in {"content-length", "transfer-encoding", "connection", "set-cookie"}})
    for cookie in result.headers.get_list("set-cookie"):
        response.headers.append("set-cookie", cookie)
    return response


@app.get("/lmstudio/v1/models")
@app.get("/lmstudio/api/v0/models")
async def models():
    return {"data": [{"id": MODEL_ID, "state": "loaded"}]}


@app.get("/lmstudio/status")
async def inference_status(request: Request):
    if request.state.user.get("role") != "admin":
        return JSONResponse({"error": "Administrator access is required."}, status_code=403)
    queue = demo._queue
    active = [event for job in queue.active_jobs if job for event in job]
    workers = [task.get_coro().__qualname__ for task in asyncio.all_tasks()
               if "Queue.start_" in task.get_coro().__qualname__]
    return {"pending": len(queue), "active": len(active), "stopped": queue.stopped,
            "workers": workers, "active_wait_seconds": [round(time.monotonic() - e.enqueue_time) for e in active]}


@app.post("/lmstudio/v1/chat/completions")
async def completion(request: Request):
    if int(request.headers.get("content-length", "0")) > 25 * 1024 * 1024:
        return JSONResponse({"error": "Request exceeds 25 MB"}, status_code=413)
    payload = await request.json()
    # Preserve HF's signed visitor headers and cookies for quota attribution.
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"content-length", "connection", "accept-encoding"}}
    base = f"http://127.0.0.1:{APP_PORT}/gradio_api/call/read"
    user = request.state.user
    owner_email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    owner_token = os.environ.get("HF_TOKEN", "")
    bridged = bool(user.get("bridge"))
    gateway_base = owner_gateway_base()
    owner_quota = bool(owner_token and gateway_base and (bridged or (owner_email and user.get("role") == "admin"
                                                                     and user.get("email", "").lower() == owner_email)))
    # The read and its result stream pass this middleware again. A bridged caller has no session cookie, so they carry
    # the per-process gateway nonce instead; the long-lived BRIDGE_SECRET is never sent anywhere, least of all upstream.
    bridge_header = {"X-VoxelRad-Gateway": GATEWAY_NONCE} if bridged else {}
    caller = f"bridge ({user['pseudonym']})" if bridged else "space session"
    print(f"Skanda read requested by {caller}, {'owner' if owner_quota else 'visitor'} quota", flush=True)
    if owner_quota:
        # Go through HF's public gateway so it signs the PRO token's quota
        # identity. Passing Authorization only to localhost cannot do that.
        # Never forward the anonymous visitor token, Host, or Origin here.
        base = gateway_base
        headers = {"Authorization": "Bearer " + owner_token,
                   "Cookie": request.headers.get("cookie", ""), **bridge_header}
    async with httpx.AsyncClient(timeout=600) as client:
        queued = await client.post(base, headers=headers, json={"data": [payload]})
        if not queued.is_success:
            return JSONResponse({"error": "The inference queue is unavailable."}, status_code=503)
        event_id = queued.json()["event_id"]
        from fastapi.responses import StreamingResponse

    async def result_stream():
        completed = False
        try:
            async with asyncio.timeout(READ_TIMEOUT_SECONDS):
                async with httpx.AsyncClient(timeout=600) as client:
                    async with client.stream("GET", f"http://127.0.0.1:{APP_PORT}/gradio_api/call/read/{event_id}", headers={"cookie": request.headers.get("cookie", ""), "host": request.headers.get("host", "localhost"), **bridge_header}) as events:
                        events.raise_for_status()
                        event = ""
                        async for line in events.aiter_lines():
                            if line.startswith("event: "):
                                event = line[7:]
                            elif line.startswith("data: "):
                                if event == "heartbeat":
                                    yield ": queued\n\n"
                                elif event == "error":
                                    yield "data: " + json.dumps({"error": {"message": "ZeroGPU read failed or quota exhausted. " + line[6:]}}) + "\n\n"
                                    yield "data: [DONE]\n\n"
                                    completed = True
                                    return
                                elif event == "complete":
                                    result = json.loads(line[6:])[0]
                                    yield "data: " + json.dumps({"id": "chatcmpl-" + uuid.uuid4().hex,
                                        "object": "chat.completion.chunk", "model": MODEL_ID,
                                        "choices": [{"index": 0, "delta": {"content": result["text"]}, "finish_reason": result["finish"]}]}) + "\n\n"
                                    yield "data: [DONE]\n\n"
                                    completed = True
                                    return
                        yield "data: " + json.dumps({"error": {"message": "ZeroGPU queue disconnected before completion."}}) + "\n\n"
        except TimeoutError:
            yield "data: " + json.dumps({"error": {"message": f"ZeroGPU read timed out after {READ_TIMEOUT_SECONDS} seconds without a completed result. The pending request was cancelled. No findings were generated."}}) + "\n\n"
            yield "data: [DONE]\n\n"
        except httpx.HTTPError:
            yield "data: " + json.dumps({"error": {"message": "ZeroGPU result connection failed. No findings were generated."}}) + "\n\n"
            yield "data: [DONE]\n\n"
        finally:
            if not completed:
                # Drop pending jobs and mark an active scheduler wait as disconnected.
                # Cleanup also runs when the browser cancels or closes the stream.
                await asyncio.shield(demo._queue.clean_events(event_id=event_id))
    return StreamingResponse(result_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Voxelrad-Quota-Identity": "owner" if owner_quota else "visitor"})


with gr.Blocks() as demo:
    gr.Markdown("# Skanda V1\nOpen [/workspace](/workspace) for the full radiology application.")
    payload = gr.JSON(visible=False)
    output = gr.JSON(visible=False)
    gr.Button("Read", visible=False).click(infer, inputs=payload, outputs=output, api_name="read")
demo.queue(default_concurrency_limit=1, max_size=8)


async def web(path: str):
    root = (ROOT / "app/dist").resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        return Response(status_code=404)
    if not target.is_file():
        if path.startswith("assets/"):
            return Response(status_code=404)
        target = root / ("shared.html" if path == "shared" else "index.html")
    return FileResponse(target, headers={"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"})


if __name__ == "__main__":
    # Standard launch runs the ZeroGPU tensor-packing/registration hook and sets
    # the Gradio server context used for visitor quotas. The existing React UI
    # provides all pages, so Gradio's Node SSR frontend is unnecessary.
    demo.launch(_app=app, server_name="0.0.0.0", server_port=APP_PORT,
                ssr_mode=False, prevent_thread_lock=True, show_error=True)
    app.router.routes[:] = [route for route in app.router.routes
                           if getattr(route, "path", None) not in {"/", "/assets/{path:path}", "/favicon.ico", "/robots.txt"}]
    app.add_api_route("/{path:path}", web, methods=["GET"])
    demo.block_thread()
