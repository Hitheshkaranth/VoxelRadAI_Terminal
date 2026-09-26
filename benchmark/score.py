"""Score benchmark results: per-class sensitivity, normal specificity, false-positive classes, parse/latency stats."""
import json, re, sys, statistics as st
from collections import Counter, defaultdict

KEY = sys.argv[1] if len(sys.argv) > 1 else "final"   # "main" = before lung-pattern pass, "final" = after
rows = [json.loads(l) for l in open(sys.argv[2] if len(sys.argv) > 2 else "results.jsonl")]

# Keyword map from model finding text → NIH label class. Negations are excluded because only non-normal findings are scored.
CLS = {
    "Effusion": r"effusion|blunt(ed|ing) of the costophrenic|meniscus",
    "Cardiomegaly": r"cardiomegaly|cardiac enlargement|enlarged (heart|cardiac)|cardiothoracic ratio|heart size.*(enlarg|increas)",
    "Pneumothorax": r"pneumothorax",
    "Edema": r"o?edema|congestion|kerley|vascular redistribution|cephalization",
    "Consolidation": r"consolidat|airspace|air-space|air bronchogram",
    "Pneumonia": r"pneumonia|consolidat|airspace|infect",
    "Infiltration": r"infiltrat|opacit|interstitial|markings|haz|reticul",
    "Atelectasis": r"atelecta|collapse|volume loss",
    "Mass": r"mass|lesion|tumou?r",
    "Nodule": r"nodul|mass|lesion",
}

def abnormal(r):
    a = r.get(KEY)
    return [f for f in (a or {}).get("findings", []) if f["severity"] != "normal"]

def text(fs): return " ".join(f"{f['title']} {f.get('description','')}".lower() for f in fs)

tp = Counter(); n = Counter(); miss = defaultdict(list); fp_cls = Counter()
norm_total = norm_clear = 0; fp_cases = []
for r in rows:
    fs = abnormal(r); t = text(fs)
    if r["labels"] == ["No Finding"]:
        norm_total += 1
        if not fs: norm_clear += 1
        else:
            fp_cases.append((r["id"], [f["title"] for f in fs]))
            for c, rx in CLS.items():
                if re.search(rx, t): fp_cls[c] += 1
        continue
    for lab in r["labels"]:
        if lab not in CLS: continue
        n[lab] += 1
        if re.search(CLS[lab], t): tp[lab] += 1
        else: miss[lab].append((r["id"], [f["title"] for f in fs] or ["(called normal)"]))

any_abn = [r for r in rows if r["labels"] != ["No Finding"]]
flagged = sum(1 for r in any_abn if abnormal(r))
print(f"=== scoring '{KEY}' on {len(rows)} images ===")
print(f"Abnormal studies flagged as abnormal (any finding): {flagged}/{len(any_abn)}")
print(f"Normal studies called normal (specificity):        {norm_clear}/{norm_total}")
print("\nPer-class sensitivity (finding of the right type reported):")
for c in CLS:
    if n[c]: print(f"  {c:14s} {tp[c]}/{n[c]}")
print(f"  {'TOTAL':14s} {sum(tp.values())}/{sum(n.values())}")
print("\nFalse-positive finding types on normal studies:", dict(fp_cls))
for i, f in fp_cases: print("  FP", i, f)
print("\nMisses:")
for c, v in miss.items():
    for i, f in v: print(f"  {c:13s} {i:14s} → {'; '.join(f)[:110]}")

ok = [r for r in rows if r.get("parse") == "ok"]
print(f"\nParse OK: {len(ok)}/{len(rows)}   errors: {sum(1 for r in rows if r.get('error'))}")
print("finish reasons:", Counter(r.get("finish") for r in rows))
ms = [r["totalMs"] / 1000 for r in rows if "totalMs" in r]
if ms: print(f"latency s: median {st.median(ms):.0f}, p90 {sorted(ms)[int(len(ms)*0.9)-1]:.0f}, max {max(ms):.0f}")
tk = [r["tokens"] for r in rows if r.get("tokens")]
if tk: print(f"output tokens: median {st.median(tk):.0f}, max {max(tk)}")
boxes = [f for r in rows for f in abnormal(r)]
print(f"abnormal findings with bbox: {sum(1 for f in boxes if f.get('bbox'))}/{len(boxes)}")
sev = Counter(f["severity"] for f in boxes); print("severity mix:", dict(sev))
print("pattern grades:", Counter((r.get('pattern') or {}).get('grade') for r in rows))
