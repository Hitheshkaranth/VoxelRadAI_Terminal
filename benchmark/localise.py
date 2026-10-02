"""Localisation on the ChestX-Det test split: how well each source points at the radiologist-boxed lesion.

  uv run --with torchxrayvision --with scikit-image localise.py          # needs the committed results + benchmark/img/

For every detected finding (its text matches a labelled class, scorer's CXD map):
- box overlap: the finding's box touches a radiologist box of that class;
- box centre: the box centre lies inside one (stricter; this is score.py's localisation line).
For the app's heatmap overlay (txrv_server.heatmaps, the exact code the app calls): for every labelled class with a
radiologist box, the heatmap peak of the matching finding type lies inside one.
"""
import base64, json, re, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../app/server"))
import score  # noqa: E402
from txrv_server import heatmaps  # noqa: E402

KIND = {"Effusion": "effusion", "Consolidation": "opacity", "Pneumothorax": "pneumothorax", "Cardiomegaly": "cardiomegaly",
        "Atelectasis": "atelectasis", "Nodule": "nodule / mass", "Mass": "nodule / mass"}
man = {m["id"]: m for m in json.load(open("manifest-cxd.json")) if m["split"] == "test"}
touch = lambda a, b: a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]
inside = lambda x, y, b: b["x"] <= x <= b["x"] + b["w"] and b["y"] <= y <= b["y"] + b["h"]


def boxes(path):
    ov = [0, 0]; ce = [0, 0]
    for r in map(json.loads, open(path)):
        m = man.get(r["id"])
        if not m: continue
        fs = [f for f in (r.get("final") or {}).get("findings", []) if f["severity"] != "normal"]
        for c in {b["label"] for b in m["boxes"]} & score.CXD.keys():
            gt = [b for b in m["boxes"] if b["label"] == c]
            for f in fs:
                bb = f.get("bbox")
                if not (bb and (bb.get("w") or 0) > .01 and re.search(score.CXD[c], score.ftext(f))): continue
                ov[1] += 1; ov[0] += any(touch(bb, g) for g in gt)
                ce[1] += 1; ce[0] += any(inside(bb["x"] + bb["w"] / 2, bb["y"] + bb["h"] / 2, g) for g in gt)
    return ov, ce


def heat():
    hit = [0, 0]
    for m in man.values():
        want = {KIND[b["label"]] for b in m["boxes"] if b["label"] in KIND}
        if not want: continue
        maps = heatmaps(open(m["path"], "rb").read(), want)
        for c in {b["label"] for b in m["boxes"]} & KIND.keys():
            h = maps.get(KIND[c])
            if not h: continue
            data = base64.b64decode(h["data"]); i = max(range(len(data)), key=data.__getitem__)
            e = h["extent"]; x = e["x"] + (i % h["w"] + .5) / h["w"] * e["w"]; y = e["y"] + (i // h["w"] + .5) / h["h"] * e["h"]
            hit[1] += 1; hit[0] += any(inside(x, y, b) for b in m["boxes"] if b["label"] == c)
    return hit


for name, path in (("MedGemma", "results-cxd.jsonl"), ("MAIRA-2", "results-maira2-cxd.jsonl")):
    ov, ce = boxes(path)
    print(f"{name:9s} box overlaps lesion {score.wilson(*ov)} · box centre inside lesion {score.wilson(*ce)}")
print(f"{'Heatmap':9s} peak inside lesion  {score.wilson(*heat())}  (classes the classifier covers)")
