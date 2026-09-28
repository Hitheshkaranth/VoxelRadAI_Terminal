"""Local TorchXRayVision cross-check service for Skanda Radiology (http://localhost:8765, proxied by Vite at /txrv).

POST /check  {"image": "<data URL>", "findings": [{"id", "title", "description", "severity"}]}
  → {"probs": {pathology: p}, "checks": {finding_id: {"kind", "prob", "supported"}}}

A MedGemma finding is "unsupported" when the classifier probability for its finding type is below 0.5 (each
model's operating point). On the 56-image benchmark this removed 5 findings, all false (benchmark/README.md).
Only models not trained on NIH ChestX-ray14 are used, so the benchmark (NIH images) is not inflated.

  uv run --with torchxrayvision --with scikit-image server/txrv_server.py
"""
import base64, io, json, re
from http.server import BaseHTTPRequestHandler, HTTPServer

MODELS = ["densenet121-res224-chex", "densenet121-res224-mimic_ch", "densenet121-res224-pc"]
THRESHOLD = 0.5
# finding type (first match on title, then title + description) → pathologies that should support it
SUPPORT = [
    ("pneumothorax", r"pneumothorax", ["Pneumothorax"]),
    ("effusion", r"effusion|blunt", ["Effusion"]),
    ("cardiomegaly", r"cardiomegaly|enlarged (heart|cardiac)|cardiac enlargement|heart size.*enlarg|cardiothoracic", ["Cardiomegaly", "Enlarged Cardiomediastinum"]),
    ("edema", r"o?edema|congestion|kerley", ["Edema"]),
    ("nodule / mass", r"nodul|mass|lesion", ["Nodule", "Mass", "Lung Lesion"]),
    ("atelectasis", r"atelecta|collapse|volume loss", ["Atelectasis"]),
    ("opacity", r"consolidat|opacit|airspace|pneumonia|infiltrat|interstitial|markings", ["Lung Opacity", "Consolidation", "Pneumonia", "Infiltration", "Atelectasis", "Edema"]),
]


def check(finding: dict, probs: dict) -> dict | None:
    """Classifier support for one finding, or None when the type is not covered (bones, devices, normal)."""
    if finding.get("severity") == "normal":
        return None
    title = finding.get("title", "").lower()
    text = f"{title} {finding.get('description', '').lower()}"
    for hay in (title, text):  # the title decides the type; the description only when the title is not specific
        for kind, rx, keys in SUPPORT:
            if re.search(rx, hay):
                p = max(probs.get(k, 0.0) for k in keys)
                return {"kind": kind, "prob": round(p, 3), "supported": p >= THRESHOLD}
    return None


_models = None


def probabilities(image_bytes: bytes) -> dict:
    """Averaged pathology probabilities (0.5 = operating point) for one radiograph."""
    global _models
    import skimage.io, torch, torchvision, torchxrayvision as xrv
    if _models is None:
        _models = [xrv.models.DenseNet(weights=w).eval() for w in MODELS]
    img = skimage.io.imread(io.BytesIO(image_bytes))
    if img.ndim == 3:
        img = img[..., :3].mean(2)
    img = xrv.datasets.normalize(img, 255 if img.max() <= 255 else 65535)[None, ...]
    img = torchvision.transforms.Compose([xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)])(img)
    acc: dict = {}
    with torch.no_grad():
        for m in _models:
            for p, v in zip(m.pathologies, m(torch.from_numpy(img)[None])[0].tolist()):
                if p:
                    acc.setdefault(p, []).append(v)
    return {p: round(sum(v) / len(v), 3) for p, v in acc.items()}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/check":
            return self.send_error(404)
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            probs = probabilities(base64.b64decode(body["image"].split(",", 1)[-1]))
            checks = {f["id"]: c for f in body.get("findings", []) if (c := check(f, probs))}
            self._json(200, {"probs": probs, "checks": checks})
        except Exception as e:  # noqa: BLE001 — report to the client, keep serving
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        self._json(200, {"ok": True, "models": MODELS}) if self.path == "/health" else self.send_error(404)

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("TorchXRayVision cross-check on http://localhost:8765 (models load on the first request)", flush=True)
    HTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
