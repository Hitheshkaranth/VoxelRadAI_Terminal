"""Local TorchXRayVision cross-check service for Skanda Radiology (http://localhost:8765, proxied by Vite at /txrv).

POST /check  {"image": "<data URL>", "findings": [{"id", "title", "description", "severity"}], "heatmaps"?: true}
  → {"probs": {pathology: p}, "checks": {finding_id: {"kind", "prob", "thr", "thrSource", "calibrated"?, "supported"}},
     "heatmaps"?: {kind: {"w", "h", "data": base64 uint8, "extent": {"x", "y", "w", "h"}}}}
GET /health → {"ok", "models", "thresholds": {"source", "generated"}}

A MedGemma finding is "unsupported" when the classifier probability for its finding type is below that type's
operating point. Per-type thresholds (and calibration knots mapping probability → observed positive rate) come from
thresholds.json next to this file, tuned on the ChestX-Det dev split (benchmark/fuse.py); without it every type uses
0.5. Findings the classifier has no output for (fractures, calcification, devices, emphysema, ...) come back with
prob None, supported None and reason "not covered", so the app can say so instead of staying silent.

ChestX-Det images are NIH ChestX-ray14 images re-annotated by radiologists, so only models not trained on NIH are
used: otherwise both the 56-image NIH set and ChestX-Det would be inflated.

  uv run --with torchxrayvision --with scikit-image server/txrv_server.py
"""
import base64, io, json, os, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["densenet121-res224-chex", "densenet121-res224-mimic_ch", "densenet121-res224-pc"]
DEFAULT_THR = 0.5
MAX_BODY = 25 * 1024 * 1024
# finding type (first match on title, then title + description) → pathologies that should support it
SUPPORT = [
    ("pneumothorax", r"pneumothorax", ["Pneumothorax"]),
    ("effusion", r"effusion|blunt", ["Effusion"]),
    ("cardiomegaly", r"cardiomegaly|enlarged (heart|cardiac)|cardiac enlargement|heart size.*enlarg|cardiothoracic", ["Cardiomegaly", "Enlarged Cardiomediastinum"]),
    ("edema", r"o?edema|congestion|kerley", ["Edema"]),
    ("nodule / mass", r"nodul|\bmass\b(?! effect)|lesion", ["Nodule", "Mass", "Lung Lesion"]),
    ("atelectasis", r"atelecta|collapse|volume loss", ["Atelectasis"]),
    ("opacity", r"consolidat|opacit|airspace|pneumonia|infiltrat|interstitial|markings", ["Lung Opacity", "Consolidation", "Pneumonia", "Infiltration", "Atelectasis", "Edema"]),
]
# Abnormal findings the classifier cannot judge; reported as "not covered" rather than dropped.
NOT_COVERED = re.compile(r"fracture|calcif|device|\bline\b|\btube\b|pacemaker|\bclips?\b|emphysema|fibrosis|thicken")


def load_thresholds(path: str) -> dict:
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


THRESHOLDS_FILE = load_thresholds(os.path.join(os.path.dirname(os.path.abspath(__file__)), "thresholds.json"))
THRESHOLDS: dict = THRESHOLDS_FILE.get("kinds", {})


def calibrate(p: float, knots: list) -> float | None:
    """Piecewise-linear map of probability → observed positive rate over sorted [prob, rate] knots, clamped at the ends."""
    if not knots:
        return None
    ks = sorted(knots)
    if p <= ks[0][0]:
        return ks[0][1]
    for (x0, y0), (x1, y1) in zip(ks, ks[1:]):
        if p <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (p - x0) / (x1 - x0)
    return ks[-1][1]


def check(finding: dict, probs: dict, thresholds: dict | None = None) -> dict | None:
    """Classifier support for one finding; None for normal findings and types unrelated to anything we know."""
    if finding.get("severity") == "normal":
        return None
    table = THRESHOLDS if thresholds is None else thresholds
    title = finding.get("title", "").lower()
    text = f"{title} {finding.get('description', '').lower()}"
    for hay in (title, text):  # the title decides the type; the description only when the title is not specific
        for kind, rx, keys in SUPPORT:
            if re.search(rx, hay):
                p = max(probs.get(k, 0.0) for k in keys)
                tuned = table.get(kind, {})
                thr = tuned.get("thr", DEFAULT_THR)
                out = {"kind": kind, "prob": round(p, 3), "thr": thr, "thrSource": "default" if tuned.get("default", "thr" not in tuned) else "tuned"}
                cal = calibrate(p, tuned.get("knots") or [])
                if cal is not None:
                    out["calibrated"] = round(cal, 3)
                out["supported"] = p >= thr
                return out
    for hay in (title, text):
        if m := NOT_COVERED.search(hay):
            return {"kind": m.group(0), "prob": None, "supported": None, "reason": "not covered"}
    return None


_models = None
_load_lock = threading.Lock()


def _prepare(image_bytes: bytes, size: int = 224):
    """Grayscale, normalised, centre-cropped and resized image as a (1, 1, size, size) tensor, plus the crop's extent
    in the original image (normalised x, y, w, h)."""
    import skimage.io, torch, torchvision, torchxrayvision as xrv
    img = skimage.io.imread(io.BytesIO(image_bytes))
    if img.ndim == 3:
        img = img[..., :3].mean(2)
    h, w = img.shape
    side = min(h, w)
    extent = {"x": (w - side) / 2 / w, "y": (h - side) / 2 / h, "w": side / w, "h": side / h}
    img = xrv.datasets.normalize(img, 255 if img.max() <= 255 else 65535)[None, ...]
    img = torchvision.transforms.Compose([xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(size)])(img)
    return torch.from_numpy(img)[None].float(), extent


def _load_models():
    global _models
    import torchxrayvision as xrv
    with _load_lock:  # concurrent first requests must not load the weights twice
        if _models is None:
            _models = [xrv.models.DenseNet(weights=w).eval() for w in MODELS]
    return _models


def probabilities(image_bytes: bytes) -> dict:
    """Averaged pathology probabilities (0.5 = each model's operating point) for one radiograph."""
    import torch
    _load_models()
    img, _ = _prepare(image_bytes)
    acc: dict = {}
    with torch.no_grad():
        for m in _models:
            for p, v in zip(m.pathologies, m(img)[0].tolist()):
                if p:
                    acc.setdefault(p, []).append(v)
    return {p: round(sum(v) / len(v), 3) for p, v in acc.items()}


# Class activation maps for the viewer's heatmap overlay: where each type's score comes from, kept to the lungs (the
# heart for cardiomegaly) with TorchXRayVision's ChestX-Det anatomy model. On the held-out ChestX-Det test split the
# peak fell inside a radiologist box for 26/152 labelled findings (17%, benchmark/localise.py; unmasked it was worse),
# so the app shows it as a coarse hint, never as a localisation.
CAM_KEYS = {
    "pneumothorax": ["Pneumothorax"], "effusion": ["Effusion"], "cardiomegaly": ["Cardiomegaly"], "edema": ["Edema"],
    "nodule / mass": ["Nodule", "Mass"], "atelectasis": ["Atelectasis"], "opacity": ["Lung Opacity", "Consolidation"],
}
HEAT = 32  # grid sent to the browser; it is upsampled smoothly there
_seg = None


def _anatomy(image_bytes: bytes):
    """(lungs, heart) boolean masks at 224 px, or (None, None) when the anatomy model is unavailable."""
    global _seg
    import torch, torch.nn.functional as F, torchxrayvision as xrv
    try:
        with _load_lock:
            if _seg is None:
                _seg = xrv.baseline_models.chestx_det.PSPNet().eval()
        x, _ = _prepare(image_bytes, 512)
        with torch.no_grad():
            o = torch.sigmoid(_seg(x))[0]
        t = _seg.targets
        lungs = torch.maximum(o[t.index("Left Lung")], o[t.index("Right Lung")])
        heart = o[t.index("Heart")]
        down = lambda m: F.interpolate(m[None, None], size=(224, 224), mode="bilinear", align_corners=False)[0, 0] > 0.5
        return down(lungs), down(heart)
    except Exception:  # noqa: BLE001 — the heatmap falls back to unmasked
        return None, None


def heatmaps(image_bytes: bytes, kinds) -> dict:
    """{kind: {"w", "h", "data": base64 of row-major uint8 0–255, "extent": crop extent in the original image}}."""
    import torch, torch.nn.functional as F
    models = _load_models()
    kinds = [k for k in kinds if k in CAM_KEYS]
    if not kinds:
        return {}
    img, extent = _prepare(image_bytes)
    lungs, heart = _anatomy(image_bytes)
    acc: dict = {}
    with torch.no_grad():
        for m in models:
            f = F.relu(m.features(img))[0]  # (1024, 7, 7); DenseNet: global average pool → linear, so CAM is exact
            for kind in kinds:
                for key in CAM_KEYS[kind]:
                    if key in m.pathologies:
                        c = torch.einsum("k,kij->ij", m.classifier.weight[m.pathologies.index(key)], f)
                        c = c - c.min()
                        acc.setdefault(kind, []).append(c / (c.max() + 1e-6))
    out = {}
    for kind, maps in acc.items():
        cam = F.interpolate(torch.stack(maps).mean(0)[None, None], size=(224, 224), mode="bilinear", align_corners=False)[0, 0]
        mask = heart if kind == "cardiomegaly" else lungs
        if mask is not None and mask.any():
            grown = F.max_pool2d(mask[None, None].float(), 23, stride=1, padding=11)[0, 0] > 0  # ~5% margin
            cam = cam * grown
        cam = F.adaptive_avg_pool2d(cam[None, None], HEAT)[0, 0]
        cam = (cam / (cam.max() + 1e-6) * 255).round().clamp(0, 255).to(torch.uint8)
        out[kind] = {"w": HEAT, "h": HEAT, "data": base64.b64encode(cam.numpy().tobytes()).decode(), "extent": extent}
    return out


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/check":
            return self.send_error(404)
        size = self.headers.get("Content-Length")
        if size is None or not size.isdigit():
            return self._json(411, {"error": "Content-Length required"})
        if int(size) > MAX_BODY:
            return self._json(413, {"error": "image too large"})
        try:
            body = json.loads(self.rfile.read(int(size)))
            raw = base64.b64decode(body["image"].split(",", 1)[-1])
            probs = probabilities(raw)
            checks = {f["id"]: c for f in body.get("findings", []) if (c := check(f, probs))}
            out = {"probs": probs, "checks": checks}
            if body.get("heatmaps"):
                out["heatmaps"] = heatmaps(raw, {c["kind"] for c in checks.values() if c.get("prob") is not None})
            self._json(200, out)
        except Exception as e:  # noqa: BLE001 — report to the client, keep serving
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        if self.path != "/health":
            return self.send_error(404)
        meta = {k: THRESHOLDS_FILE.get(k) for k in ("source", "generated")} if THRESHOLDS else {"source": "default 0.5", "generated": None}
        self._json(200, {"ok": True, "models": MODELS, "thresholds": meta})

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("TorchXRayVision cross-check on http://localhost:8765 (models load on the first request)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
