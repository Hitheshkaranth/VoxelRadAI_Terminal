"""Skanda V1 on a dedicated GPU: the same contract as the ZeroGPU Space's /lmstudio/v1 bridge.

Run one container per GPU and list them all in the API's MODEL_UPSTREAMS. Each server:
  * accepts only callers with the shared X-VoxelRad-Bridge secret (BRIDGE_SECRET, 32+ characters);
  * runs one read at a time on its GPU and queues up to MAX_QUEUE more; beyond that it answers 429 at once, which
    tells the API to try another upstream before anything reaches a GPU;
  * streams SSE exactly like the Space: ": queued" heartbeats, one chat.completion.chunk with the whole result,
    then [DONE]; failures arrive as a data: {"error": ...} event;
  * stops waiting for a read after READ_TIMEOUT_SECONDS (default 180, as on the Space).

The read logic mirrors infer() in deploy/huggingface/space_app.py; keep the two in step.
"""
import asyncio
import hmac
import json
import os
import re
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

MODEL_ID = "skanda-v1"
MAX_BODY = 25 * 1024 * 1024
PROTECTED = re.compile(r"^/(v1|api|status)(/|$)")


def create_app(read, *, bridge_secret, max_queue=8, read_timeout=180.0, heartbeat=10.0):
    """`read(payload) -> (text, finish)` runs one blocking read on the GPU (called in a worker thread)."""
    if not bridge_secret or len(bridge_secret) < 32:
        raise ValueError("BRIDGE_SECRET must be at least 32 characters")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    gpu = asyncio.Semaphore(1)
    state = {"waiting": 0, "running": 0, "completed": 0, "failed": 0, "rejected": 0}

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if PROTECTED.match(request.url.path):
            supplied = request.headers.get("x-voxelrad-bridge", "")
            if not supplied or not hmac.compare_digest(supplied.encode(), bridge_secret.encode()):
                return JSONResponse({"error": "Bridge credentials are required."}, status_code=401)
        return await call_next(request)

    @app.get("/healthz")
    async def health():
        return {"ok": True, "model": MODEL_ID}

    @app.get("/v1/models")
    @app.get("/api/v0/models")
    async def models():
        return {"data": [{"id": MODEL_ID, "state": "loaded"}]}

    @app.get("/status")
    async def status():
        return {**state, "max_queue": max_queue}

    @app.get("/metrics")
    async def metrics():
        lines = []
        for name, value in state.items():
            kind = "gauge" if name in ("waiting", "running") else "counter"
            metric = f"skanda_gpu_reads_{name}" + ("_total" if kind == "counter" else "")
            lines += [f"# TYPE {metric} {kind}", f"{metric} {value}"]
        return PlainTextResponse("\n".join(lines) + "\n")

    def event(data):
        return "data: " + json.dumps(data) + "\n\n"

    def error(message):
        return event({"error": {"message": message}}) + "data: [DONE]\n\n"

    @app.post("/v1/chat/completions")
    async def completion(request: Request):
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            return JSONResponse({"error": "Request exceeds 25 MB"}, status_code=413)
        try:
            payload = await request.json()
        except ValueError:
            return JSONResponse({"error": "Request must contain a JSON object."}, status_code=400)
        if not isinstance(payload, dict):
            return JSONResponse({"error": "Request must contain a JSON object."}, status_code=400)
        if payload.get("model", MODEL_ID) != MODEL_ID:
            return JSONResponse({"error": f"Unknown model. This server runs {MODEL_ID}."}, status_code=404)
        # Admission is decided before the stream starts, so a full server is a fast 429 the API can fail over on.
        if state["waiting"] + state["running"] > max_queue:
            state["rejected"] += 1
            return JSONResponse({"error": "The model service is busy."}, status_code=429)
        state["waiting"] += 1

        async def stream():
            acquired = False
            job = None
            acquire = asyncio.ensure_future(gpu.acquire())
            try:
                async with asyncio.timeout(read_timeout):
                    while not acquire.done():
                        await asyncio.wait({acquire}, timeout=heartbeat)
                        if not acquire.done():
                            yield ": queued\n\n"
                    acquired = True
                    state["waiting"] -= 1
                    state["running"] += 1
                    job = asyncio.ensure_future(asyncio.to_thread(read, payload))
                    while not job.done():
                        await asyncio.wait({job}, timeout=heartbeat)
                        if not job.done():
                            yield ": queued\n\n"
                    text, finish = job.result()
                state["completed"] += 1
                yield event({"id": "chatcmpl-" + uuid.uuid4().hex, "object": "chat.completion.chunk", "model": MODEL_ID,
                             "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": finish}]})
                yield "data: [DONE]\n\n"
            except TimeoutError:
                state["failed"] += 1
                yield error(f"Skanda read timed out after {int(read_timeout)} seconds. No findings were generated.")
            except asyncio.CancelledError:
                state["failed"] += 1
                raise
            except Exception as failure:  # the model raised: report it, keep the server up
                state["failed"] += 1
                print(f"Skanda read failed: {type(failure).__name__}", flush=True)
                yield error("Skanda read failed on the GPU server. No findings were generated.")
            finally:
                if not acquired:
                    state["waiting"] -= 1
                    if acquire.done() and not acquire.cancelled():
                        gpu.release()  # acquired in the same instant the wait ended
                    else:
                        acquire.cancel()
                else:
                    state["running"] -= 1
                    # A thread cannot be stopped: keep the GPU reserved until a timed-out read really ends.
                    if job is not None and not job.done():
                        job.add_done_callback(lambda _: gpu.release())
                    else:
                        gpu.release()

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return app


def load_reader():
    """Download the private Skanda V1 snapshot (HF_TOKEN, MODEL_REVISION) and return read(payload)."""
    from huggingface_hub import snapshot_download

    model_path = snapshot_download(
        os.environ.get("MODEL_REPO", "hitheshkaranth/Skanda-V1"),
        revision=os.environ["MODEL_REVISION"],
        allow_patterns=["code/*", "vlm/*", "skanda_config.json", "skanda_heads.pt", "hint_classifier.pt"],
    )
    sys.path.insert(0, str(Path(model_path) / "code"))
    from skanda.serve import Skanda, content_image, content_text, request_ctx, LUNG_PATTERN_MARK

    reader = Skanda(model_path)

    def read(payload):
        messages = payload.get("messages", [])
        system = " ".join(content_text(m["content"]) for m in messages if m.get("role") == "system")
        image = next((im for im in (content_image(m["content"]) for m in messages if m.get("role") == "user") if im), None)
        tokens = min(max(int(payload.get("max_tokens") or 1024), 1), 1536)
        temperature = float(payload.get("temperature") or 0.0)
        with reader.lock:
            if image is not None and LUNG_PATTERN_MARK in system:
                return json.dumps({"grade": 0, "evidence": "Skanda reports diffuse findings in its main read."}), "stop"
            if image is not None:
                ctx = request_ctx(payload, image)
                if ctx and ctx.get("hu") is not None:
                    from skanda import ctmri
                    image = ctmri.render_ct(ctx["hu"])
                result, raw, finished, _ = reader.read(image, tokens, temperature, ctx=ctx)
                return (json.dumps(result) if result is not None else raw), ("stop" if finished else "length")
            text, finished, _ = reader.chat_text(messages, tokens, temperature)
            return text, "stop" if finished else "length"

    return read


if __name__ == "__main__":
    import uvicorn

    app = create_app(load_reader(), bridge_secret=os.environ.get("BRIDGE_SECRET", ""),
                     max_queue=int(os.environ.get("MAX_QUEUE", "8")),
                     read_timeout=float(os.environ.get("READ_TIMEOUT_SECONDS", "180")))
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="warning")
