"""Score benchmark results: per-class sensitivity, normal specificity, precision per reported type, localisation,
parse/latency stats — each with a Wilson 95% interval.

  python3 score.py final results.jsonl                        # one run, full detail
  python3 score.py final run1.jsonl run2.jsonl run3.jsonl     # several runs: detail for the first, then mean [min–max]
  python3 score.py final results-cxd.jsonl --split test       # only the held-out half of a split manifest
  python3 score.py final results.jsonl --emit-ts ../app/src/lib/reliability.generated.ts --label "…"   # app table

KEY "main" = before the lung-pattern pass, "final" = after. Ground-truth boxes and splits come from the manifests.
Importable: load(path) → rows, score(rows, split) → counts, report(stats) prints them (fuse.py uses all three).
"""
import datetime, json, math, os, re, sys, statistics as st
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = {m["id"]: m for p in ("manifest.json", "manifest-cxd.json") if os.path.exists(os.path.join(HERE, p))
            for m in json.load(open(os.path.join(HERE, p)))}

# Keyword map from model finding text → label class. Negations are excluded because only non-normal findings are scored.
CLS = {
    "Effusion": r"effusion|blunt(ed|ing) of the costophrenic|meniscus",
    "Cardiomegaly": r"cardiomegaly|cardiac enlargement|enlarged (heart|cardiac)|cardiothoracic ratio|heart size.*(enlarg|increas)",
    "Pneumothorax": r"pneumothorax",
    "Edema": r"o?edema|congestion|kerley|vascular redistribution|cephalization",
    "Consolidation": r"consolidat|airspace|air-space|alveolar|air bronchogram",
    "Pneumonia": r"pneumonia|consolidat|airspace|alveolar|infect",
    "Infiltration": r"infiltrat|opaci|interstitial|markings|haz|reticul",
    "Atelectasis": r"atelecta|collapse|volume loss",
    "Mass": r"mass|lesion|tumou?r|round(ed)? opaci",
    "Nodule": r"nodul|mass|lesion|round(ed)? opaci",
}
# ChestX-Det (radiologist labels): its Consolidation class covers any focal airspace opacity, plus 6 more classes.
# Kept separate so the original NIH/Kermany numbers stay comparable with earlier runs.
CXD = {
    **{k: CLS[k] for k in ("Effusion", "Cardiomegaly", "Pneumothorax", "Atelectasis", "Mass", "Nodule")},
    "Consolidation": r"consolidat|airspace|air-space|alveolar|air bronchogram|opaci|pneumonia|infiltrat",
    "Diffuse Nodule": r"nodul|miliary",
    "Fibrosis": r"fibros|fibrot|scar|reticul",
    "Pleural Thickening": r"pleural thicken|thickening of the pleura|pleural scar|apical cap",
    "Fracture": r"fractur",
    "Calcification": r"calcif|granulom",
    "Emphysema": r"emphysem|hyperinfla|hyperexpan|bulla|bullous|copd",
}
# Reported finding type (first match on the title, then title + description) → labels that confirm it.
TYPES = [
    ("pneumothorax", r"pneumothorax", {"Pneumothorax"}),
    ("effusion", r"effusion|blunt", {"Effusion"}),
    ("cardiomegaly", CLS["Cardiomegaly"], {"Cardiomegaly"}),
    ("fracture", r"fractur", {"Fracture"}),
    ("emphysema", CXD["Emphysema"], {"Emphysema"}),
    ("calcification", CXD["Calcification"], {"Calcification"}),
    ("pleural thickening", CXD["Pleural Thickening"], {"Pleural Thickening"}),
    ("fibrosis / scarring", r"fibros|fibrot|scar", {"Fibrosis", "Pleural Thickening"}),
    ("edema / congestion", r"o?edema|congestion|kerley", {"Edema"}),
    ("nodule / mass", r"nodul|mass|lesion", {"Nodule", "Mass", "Diffuse Nodule"}),
    ("atelectasis", r"atelecta|collapse|volume loss", {"Atelectasis"}),
    ("consolidation / opacity", r"consolidat|opacit|airspace|alveolar|pneumonia|infiltrat|interstitial|markings",
     {"Consolidation", "Pneumonia", "Infiltration", "Atelectasis", "Edema", "Fibrosis"}),
]


def abnormal(r, key="final"):
    return [f for f in (r.get(key) or {}).get("findings", []) if f["severity"] != "normal"]


def ftext(f): return f"{f['title']} {f.get('description', '')}".lower()


def ftype(f):
    for hay in (f["title"].lower(), ftext(f)):
        for kind, rx, _ in TYPES:
            if re.search(rx, hay): return kind


def confirms(kind): return next(c for k, _, c in TYPES if k == kind)


def wilson_ci(k, n):
    """Wilson 95% interval (lower, upper) for k successes out of n; (0, 1) when n is 0."""
    if not n: return 0.0, 1.0
    z, p = 1.96, k / n
    d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def wilson(k, n):
    if not n: return ""
    lo, hi = wilson_ci(k, n)
    return f"{k}/{n} ({100 * k / n:.0f}%, CI {100 * lo:.0f}–{100 * hi:.0f})"


def box_ok(b):
    """Boxes thinner than 1% of the image (MAIRA-2 point boxes, annotation slips) cannot localise anything."""
    try: return b["w"] >= 0.01 and b["h"] >= 0.01
    except (TypeError, KeyError): return False  # missing box, or w/h null (an old parser's degenerate output)


def inside(f, b):
    """Predicted box centre inside ground-truth box b; None when the finding has no usable box."""
    bb = f.get("bbox")
    if not box_ok(bb): return None
    if not box_ok(b): return False
    cx, cy = bb["x"] + bb["w"] / 2, bb["y"] + bb["h"] / 2
    return b["x"] <= cx <= b["x"] + b["w"] and b["y"] <= cy <= b["y"] + b["h"]


def load(path):
    return [json.loads(l) for l in open(path) if l.strip()]


def score(rows, split=None, key="final"):
    """Counts for one results file. Pure: reads only the rows and the manifests' boxes/splits."""
    if split: rows = [r for r in rows if MANIFEST.get(r["id"], {}).get("split") == split]
    M = {"rows": rows, "key": key, "split": split, "tp": Counter(), "n": Counter(), "miss": defaultdict(list), "fp": [],
         "prec": defaultdict(lambda: [0, 0]), "fprec": defaultdict(lambda: defaultdict(lambda: [0, 0])), "loc": [0, 0],
         "fallback": sum(1 for r in rows if r.get("parse") == "fallback"), "loc_excluded": 0}
    for r in rows:
        fs = abnormal(r, key); labels = set(r["labels"]); gt = MANIFEST.get(r["id"], {}).get("boxes", [])
        for kind in {ftype(f) for f in fs} - {None}:
            M["prec"][kind][1] += 1
            M["prec"][kind][0] += bool(labels & confirms(kind))
        for f in fs:  # finding-level: every reported finding counts, grouped by which reader produced it
            if (kind := ftype(f)):
                cell = M["fprec"][f.get("source") or "all"][kind]
                cell[1] += 1; cell[0] += bool(labels & confirms(kind))
        if labels == {"No Finding"}:
            if fs: M["fp"].append((r["id"], [f["title"] for f in fs]))
            continue
        cls = CXD if r.get("source") == "ChestX-Det" or r["id"].startswith("cxd_") else CLS
        for lab in labels & cls.keys():
            M["n"][lab] += 1
            hits = [f for f in fs if re.search(cls[lab], ftext(f))]
            if hits:
                M["tp"][lab] += 1
                boxes = [b for b in gt if b["label"] == lab and box_ok(b)]
                if boxes and r.get("parse") == "fallback":  # output lost its <obj> tags → boxes lost, not wrong
                    M["loc_excluded"] += 1
                    continue
                located = [any(inside(f, b) for b in boxes) for f in hits if box_ok(f.get("bbox"))]
                if boxes and located:
                    M["loc"][1] += 1; M["loc"][0] += any(located)
            else:
                M["miss"][lab].append((r["id"], [f["title"] for f in fs] or ["(called normal)"]))
    norm = [r for r in rows if r["labels"] == ["No Finding"]]
    abn = [r for r in rows if r["labels"] != ["No Finding"]]
    M["flagged"] = (sum(1 for r in abn if abnormal(r, key)), len(abn))
    M["clear"] = (len(norm) - len(M["fp"]), len(norm))
    M["right"] = (sum(M["tp"].values()), sum(M["n"].values()))
    return M


def report(M, path="", others=()):
    """Print one run in full; with `others` (more runs of the same set) also mean [min–max] across all of them."""
    rows, key, split = M["rows"], M["key"], M["split"]
    print(f"=== scoring '{key}' on {len(rows)} images{f' (split {split})' if split else ''}: {path} ===")
    print(f"Abnormal studies flagged as abnormal (any finding): {wilson(*M['flagged'])}")
    print(f"Normal studies called normal (specificity):        {wilson(*M['clear'])}")
    print("\nPer-class sensitivity (finding of the right type reported):")
    for c in {**CLS, **CXD}:
        if M["n"][c]: print(f"  {c:18s} {wilson(M['tp'][c], M['n'][c])}")
    print(f"  {'TOTAL':18s} {wilson(*M['right'])}")
    print("\nPrecision: images where a reported finding type is confirmed by the labels:")
    for kind, (k, n) in sorted(M["prec"].items(), key=lambda kv: -kv[1][1]):
        print(f"  {kind:24s} {wilson(k, n)}")
    for src, cells in sorted(M["fprec"].items()):
        who = (f"findings tagged source={src}" if src != "all" else
               "all findings" if len(M["fprec"]) == 1 else "primary reader: findings with no source tag")
        print(f"\nPrecision, finding-level ({who}; each reported finding counts, so bilateral calls count twice):")
        for kind, (k, n) in sorted(cells.items(), key=lambda kv: -kv[1][1]):
            print(f"  {kind:24s} {wilson(k, n)}")
    if M["loc"][1]: print(f"\nLocalisation (box centre inside a ground-truth box of that class, detected findings with a box): {wilson(*M['loc'])}")
    if M["loc_excluded"]: print(f"  excluded from localisation: {M['loc_excluded']} detections in parse-fallback rows (no boxes)")
    print("\nFalse positives on normal studies:")
    for i, f in M["fp"]: print("  FP", i, f)
    print("\nMisses:")
    for c, v in M["miss"].items():
        for i, f in v: print(f"  {c:18s} {i:14s} → {'; '.join(f)[:100]}")

    ok = [r for r in rows if r.get("parse") == "ok"]
    print(f"\nParse OK: {len(ok)}/{len(rows)}   errors: {sum(1 for r in rows if r.get('error'))}")
    if M["fallback"]: print(f"Parse fallback (tags lost, sentences recovered without boxes): {M['fallback']}/{len(rows)}")
    print("finish reasons:", Counter(r.get("finish") for r in rows))
    ms = [r["totalMs"] / 1000 for r in rows if "totalMs" in r]
    if ms: print(f"latency s: median {st.median(ms):.0f}, p90 {sorted(ms)[int(len(ms) * 0.9) - 1]:.0f}, max {max(ms):.0f}")
    tk = [r["tokens"] for r in rows if r.get("tokens")]
    if tk: print(f"output tokens: median {st.median(tk):.0f}, max {max(tk)}")
    boxes = [f for r in rows for f in abnormal(r, key)]
    print(f"abnormal findings with bbox: {sum(1 for f in boxes if f.get('bbox'))}/{len(boxes)}")
    print("severity mix:", dict(Counter(f["severity"] for f in boxes)))
    print("pattern grades:", Counter((r.get('pattern') or {}).get('grade') for r in rows))

    runs = [M, *others]
    if len(runs) > 1:
        print(f"\n=== across {len(runs)} runs: mean [min–max] ===")
        def line(name, get):
            v = [get(m) for m in runs]; ps = [100 * k / n for k, n in v if n]
            print(f"  {name:28s} {st.mean(ps):5.1f}%  [{min(ps):.0f}–{max(ps):.0f}]   " + "  ".join(f"{k}/{n}" for k, n in v))
        line("abnormal flagged", lambda m: m["flagged"])
        line("normals called normal", lambda m: m["clear"])
        line("right finding type", lambda m: m["right"])
        for c in {**CLS, **CXD}:
            if M["n"][c]: line(f"  {c}", lambda m, c=c: (m["tp"][c], m["n"][c]))


def emit_ts(M, label, out):
    """Write the app's reliability table (app/src/lib/reliability.ts loads it) from one scored run."""
    hashes = Counter(r["promptHash"] for r in M["rows"] if r.get("promptHash"))
    if len(hashes) > 1: print(f"warning: rows carry {len(hashes)} prompt hashes; using the most common", file=sys.stderr)
    data = {
        "label": label,
        "split": "test" if M["split"] == "test" else "in-sample",
        "generated": datetime.date.today().isoformat(),
        "nImages": len(M["rows"]),
        "normalsClear": list(M["clear"]),
        "abnormalFlagged": list(M["flagged"]),
        **({"promptHash": hashes.most_common(1)[0][0]} if hashes else {}),
        # image-level precision, in scorer order (first match wins, title before title + description)
        "types": [{"kind": k, "pattern": rx, "correct": M["prec"][k][0], "total": M["prec"][k][1]} for k, rx, _ in TYPES],
        "sensitivity": [{"kind": c, "detected": M["tp"][c], "total": M["n"][c]} for c in {**CLS, **CXD} if M["n"][c]],
    }
    with open(out, "w") as fh:
        fh.write("// GENERATED by benchmark/score.py --emit-ts. Do not edit by hand; re-run the scorer instead.\n")
        fh.write(f"// Source: {os.path.basename(M.get('path', ''))} · key '{M['key']}' · split {M['split'] or 'all'}\n")
        fh.write("export const RELIABILITY = {\n")
        for k, v in data.items():  # one row per line keeps diffs between benchmark runs readable
            if isinstance(v, list) and v and isinstance(v[0], dict):
                rows = "".join(f"    {json.dumps(x, ensure_ascii=False)},\n" for x in v)
                fh.write(f"  {k}: [\n{rows}  ],\n")
            else:
                fh.write(f"  {k}: {json.dumps(v, ensure_ascii=False)},\n")
        fh.write("} as const\n")
    print(f"wrote {out}", file=sys.stderr)


def main(argv):
    opts = {a: argv[i + 1] for i, a in enumerate(argv) if a in ("--split", "--emit-ts", "--label")}
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] not in opts)]
    key = args[0] if args else "final"
    files = args[1:] or ["results.jsonl"]
    runs = [score(load(p), opts.get("--split"), key) for p in files]
    runs[0]["path"] = files[0]
    if "--emit-ts" in opts:
        emit_ts(runs[0], opts.get("--label") or f"Local benchmark · {files[0]}", opts["--emit-ts"])
        return
    report(runs[0], files[0], runs[1:])


if __name__ == "__main__":
    main(sys.argv[1:])
