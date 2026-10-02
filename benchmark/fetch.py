"""Download benchmark images and write a manifest.

  python3 fetch.py              # original 56-image set (NIH NLP labels + Kermany) → manifest.json
  python3 fetch.py chestxdet    # 217 ChestX-Det films, radiologist labels + boxes, dev/test split → manifest-cxd.json
"""
import json, urllib.request, subprocess, os, sys, time, hashlib, collections
API = "https://datasets-server.huggingface.co/rows?dataset={ds}&config={cfg}&split=test&offset={o}&length=100"
def rows(ds, cfg, o):
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(API.format(ds=ds, cfg=cfg, o=o), timeout=60))["rows"]
        except Exception as e:
            time.sleep(3 * (attempt + 1))
    return []
def save(url, name):
    raw = f"img/{name}.raw"; out = f"img/{name}.jpg"
    if os.path.exists(out): return out
    urllib.request.urlretrieve(url, raw)
    subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "1024", raw, "--out", out], capture_output=True)
    os.remove(raw); return out


def chestxdet():
    """ChestX-Det (NIH films re-annotated by 3 radiologists, 13 classes with boxes; Apache-2.0), official test split.
    Stratified: 60 no-finding films, then films added until every class has >= 20. Split dev/test by hash of the id,
    so thresholds and fusion rules are chosen on dev and reported on test."""
    rows = [r["row"] for o in range(0, 553, 100) for r in rows_of("MedOtter/ChestX-Det", o)]
    rows.sort(key=lambda x: hashlib.sha1(x["image_id"].encode()).hexdigest())
    pick = [x for x in rows if x["is_negative"]][:60]
    got = collections.Counter()
    for x in rows:
        s = set(json.loads(x["annotation_json"])["syms"])
        if s and any(got[c] < 20 for c in s):
            pick.append(x); got.update(s)
    manifest = []
    for x in pick:
        a = json.loads(x["annotation_json"]); w, h = x["width"], x["height"]
        name = f"cxd_{x['image_id']}"
        split = "dev" if int(hashlib.sha1(name.encode()).hexdigest(), 16) % 2 else "test"
        boxes = [{"label": c, "x": b[0] / w, "y": b[1] / h, "w": (b[2] - b[0]) / w, "h": (b[3] - b[1]) / h} for c, b in zip(a["syms"], a["boxes"])]
        manifest.append({"id": name, "source": "ChestX-Det", "split": split, "labels": sorted(set(a["syms"])) or ["No Finding"],
                         "boxes": boxes, "view": "", "age": "", "sex": "", "path": save(x["image"]["src"], name)})
    print("ChestX-Det:", len(manifest), dict(got), collections.Counter(m["split"] for m in manifest))
    json.dump(manifest, open("manifest-cxd.json", "w"), indent=1)


def rows_of(ds, o):
    r = rows(ds, "default", o)
    if not r: raise SystemExit(f"could not fetch {ds} rows at offset {o}")
    return r


if sys.argv[1:2] == ["chestxdet"]:
    os.makedirs("img", exist_ok=True); chestxdet(); sys.exit()

manifest = []
# NIH ChestX-ray14 — stratified by label
quota = {"No Finding": 12, "Effusion": 4, "Cardiomegaly": 4, "Pneumothorax": 4, "Edema": 4, "Consolidation": 4,
         "Pneumonia": 4, "Infiltration": 4, "Atelectasis": 4, "Mass": 2, "Nodule": 2}
got = {k: 0 for k in quota}
o = 0
while any(got[k] < quota[k] for k in quota) and o < 11200:
    for r in rows("BahaaEldin0/NIH-Chest-Xray-14", "default", o):
        x = r["row"]; labels = x["label"]
        # use each image for at most 2 labels to keep cases readable; skip if no needed label
        need = [l for l in labels if l in quota and got[l] < quota[l]]
        if not need or len(labels) > 2: continue
        if "No Finding" in labels and len(labels) > 1: continue
        for l in labels:
            if l in got: got[l] += 1
        name = f"nih_{r['row_idx']}"
        manifest.append({"id": name, "source": "NIH", "labels": labels, "view": x["View Position"], "age": x["Patient Age"], "sex": x["Patient Gender"], "path": save(x["image"]["src"], name)})
    o += 250
print("NIH:", got)
# Kermany pediatric pneumonia (hf-vision) — 6 normal, 6 pneumonia
k = {0: 0, 1: 0}
for o in (0, 300):
    for r in rows("hf-vision/chest-xray-pneumonia", "default", o):
        lab = r["row"]["label"]
        if k[lab] >= 6: continue
        k[lab] += 1
        name = f"kermany_{r['row_idx']}"
        manifest.append({"id": name, "source": "Kermany", "labels": ["No Finding"] if lab == 0 else ["Pneumonia"], "view": "AP/PA", "age": "child", "sex": "", "path": save(r["row"]["image"]["src"], name)})
print("Kermany:", k, "total", len(manifest))
json.dump(manifest, open("manifest.json", "w"), indent=1)
