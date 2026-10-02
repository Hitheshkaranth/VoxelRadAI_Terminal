"""Optional MAIRA-2 second reader for Skanda Radiology (http://localhost:8766, proxied by Vite at /maira).

GET  /health  → {"running": true, "loaded", "device", "memGB"}
POST /load    → loads microsoft/maira-2 (bf16, ~14 GB). 409 while LM Studio has any model resident: on a 24 GB
                machine MedGemma 27B and MAIRA-2 cannot be loaded together. Never unloads LM Studio itself.
POST /unload  → frees the weights.
POST /report  {"image": "<data URL>"} → {"findings": [{"title", "description", "severity", "bbox"?}], "raw", "ms"}
                409 "not loaded" until /load succeeds.

Weights are never loaded on start or on /health; torch and transformers are imported only inside /load, so this
module imports without them. On the held-out ChestX-Det test split, adding its effusion, nodule/mass and atelectasis
findings (only where TorchXRayVision supports them) raised MedGemma's right finding types from 90/220 to 103/220.
Sentence → finding rules are shared with benchmark/run_maira2.py (maira_parse.py).

  uv run --with "transformers>=4.48,<4.52" --with torch --with pillow --with accelerate server/maira_server.py
"""
import base64, gc, io, json, os, re, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from maira_parse import plain_sentences, to_finding

MODEL = os.environ.get("MAIRA_PATH", os.path.expanduser("~/.cache/maira-2"))  # or "microsoft/maira-2" when logged in
LMSTUDIO = os.environ.get("LMSTUDIO_URL", "http://localhost:1234")
MAX_BODY = 25 * 1024 * 1024
MAX_NEW = 450

_state: dict = {"model": None, "processor": None, "device": None}
_lock = threading.Lock()  # one load / generate at a time


def lmstudio_loaded(url: str = LMSTUDIO) -> list[str]:
    """Models LM Studio reports as resident; [] when LM Studio is not running."""
    try:
        with urllib.request.urlopen(f"{url}/api/v0/models", timeout=3) as r:
            data = json.load(r).get("data", [])
    except (OSError, ValueError):
        return []
    return [m.get("id", "?") for m in data if m.get("state") == "loaded"]


def mem_gb() -> float | None:
    if _state["model"] is None:
        return None
    import torch
    if _state["device"] == "mps":
        return round(torch.mps.current_allocated_memory() / 2**30, 1)
    return None


def load() -> tuple[int, dict]:
    with _lock:
        if _state["model"] is not None:
            return 200, {"ok": True, "message": "already loaded"}
        resident = lmstudio_loaded()
        if resident:
            return 409, {"ok": False, "message": f"LM Studio has {', '.join(resident)} loaded; unload it first (not enough memory for both)."}
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        t = time.time()
        _state["processor"] = AutoProcessor.from_pretrained(MODEL, trust_remote_code=True)
        _state["model"] = AutoModelForCausalLM.from_pretrained(MODEL, trust_remote_code=True, torch_dtype=torch.bfloat16).to(dev).eval()
        _state["device"] = dev
        return 200, {"ok": True, "message": f"loaded on {dev} in {time.time() - t:.0f}s"}


def unload() -> tuple[int, dict]:
    with _lock:
        if _state["model"] is None:
            return 200, {"ok": True, "message": "not loaded"}
        _state.update(model=None, processor=None)
        gc.collect()
        import torch
        if _state["device"] == "mps":
            torch.mps.empty_cache()
        _state["device"] = None
        return 200, {"ok": True}


def report(image_bytes: bytes) -> tuple[int, dict]:
    with _lock:
        model, processor, dev = _state["model"], _state["processor"], _state["device"]
        if model is None:
            return 409, {"error": "not loaded"}
        import torch
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        t0 = time.time()
        inputs = processor.format_and_preprocess_reporting_input(
            current_frontal=img, current_lateral=None, prior_frontal=None, prior_report=None,
            indication=None, technique="Frontal view of the chest.", comparison="None.", return_tensors="pt", get_grounding=True,
        ).to(dev)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=MAX_NEW, use_cache=True)
        text = processor.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).lstrip()
        try:
            pieces = processor.convert_output_to_plaintext_or_grounded_sequence(text)
        except AssertionError:  # malformed grounded sequence: keep the sentences, lose the boxes
            pieces = [(s, None) for s in plain_sentences(text)]
        findings = []
        for sentence, boxes in pieces:
            # boxes are relative to the processor's crop; map back to the original image, normalized 0-1
            b = [processor.adjust_box_for_original_image_size(bx, width=img.width, height=img.height) for bx in boxes or []]
            f = to_finding(sentence, b)
            findings.append({k: f[k] for k in ("title", "description", "severity", "bbox") if f.get(k) is not None})
        return 200, {"findings": findings, "raw": re.sub(r"\s+", " ", text), "ms": int((time.time() - t0) * 1000)}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            return self.send_error(404)
        self._json(200, {"running": True, "loaded": _state["model"] is not None, "device": _state["device"], "memGB": mem_gb()})

    def do_POST(self):
        try:
            if self.path == "/load":
                return self._json(*load())
            if self.path == "/unload":
                return self._json(*unload())
            if self.path != "/report":
                return self.send_error(404)
            size = self.headers.get("Content-Length")
            if size is None or not size.isdigit():
                return self._json(411, {"error": "Content-Length required"})
            if int(size) > MAX_BODY:
                return self._json(413, {"error": "image too large"})
            body = json.loads(self.rfile.read(int(size)))
            self._json(*report(base64.b64decode(body["image"].split(",", 1)[-1])))
        except Exception as e:  # noqa: BLE001 — report to the client, keep serving
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("MAIRA-2 second reader on http://localhost:8766 (weights load only on POST /load)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
