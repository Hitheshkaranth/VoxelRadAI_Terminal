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
           "NODE_ENV": "production", "PORT": "8080"}
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
        for _ in range(120):
            try:
                with psycopg.connect("postgresql://skanda@127.0.0.1/postgres", autocommit=True) as db:
                    if not db.execute("SELECT 1 FROM pg_database WHERE datname='skanda'").fetchone():
                        db.execute("CREATE DATABASE skanda")
                break
            except psycopg.OperationalError:
                time.sleep(1)
        else:
            raise RuntimeError("PostgreSQL did not become ready")
        env["DATABASE_URL"] = "postgresql://skanda@127.0.0.1/skanda"
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


# Register the GPU function before any slow downloads so ZeroGPU detects it at startup.
start_services()
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


@app.middleware("http")
async def authenticate_inference(request: Request, call_next):
    path = request.url.path
    if path.startswith("/lmstudio/") or (path.startswith("/gradio_api/") and path != "/gradio_api/startup-events"):
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
    owner_quota = bool(owner_email and owner_token and user.get("role") == "admin"
                       and user.get("email", "").lower() == owner_email)
    if owner_quota:
        # Go through HF's public gateway so it signs the PRO token's quota
        # identity. Passing Authorization only to localhost cannot do that.
        # Never forward the anonymous visitor token, Host, or Origin here.
        base = "https://hitheshkaranth-voxelrad.hf.space/gradio_api/call/read"
        headers = {"Authorization": "Bearer " + owner_token,
                   "Cookie": request.headers.get("cookie", "")}
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
                    async with client.stream("GET", f"http://127.0.0.1:{APP_PORT}/gradio_api/call/read/{event_id}", headers={"cookie": request.headers.get("cookie", ""), "host": request.headers.get("host", "localhost")}) as events:
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
