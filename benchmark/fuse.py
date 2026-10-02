"""Tune the TorchXRayVision cross-check on held-out data, then fuse MedGemma + MAIRA-2 reads (stdlib only, no model).

  python3 fuse.py                    # A: per-class thresholds on ChestX-Det dev → ../app/server/thresholds.json,
                                     #    test-split metrics; B: fuse results-cxd.jsonl (+ results-maira2-cxd.jsonl)
  MANIFEST=manifest.json python3 fuse.py --medgemma results.jsonl --maira results-maira2.jsonl --txrv txrv.jsonl
                                     # B only, on the original 56 images: IN-SAMPLE, thresholds 0.5 (or --thr FILE)

Stage A runs only on a manifest with a dev/test split. Each txrv kind (txrv_server.SUPPORT) is matched to ChestX-Det
classes; its probability is the max over the kind's pathology keys, as in the app. On dev: the threshold maximising
Youden J (sensitivity + specificity - 1) and a pooled-adjacent-violators calibration (probability → P(label)), kept
as at most 8 knots. Kinds with fewer than 10 dev positives keep the models' 0.5 operating point (default: true).

Stage B: keep every MedGemma finding (--filter-medgemma drops the ones the classifier does not support; on the
ChestX-Det dev split that lost more true findings than false ones), then add MAIRA-2 findings only for --maira-kinds the
MedGemma read lacks and the classifier supports (prob >= the kind's threshold), tagged source "maira2". Scored on the test split when there is one.
"""
import argparse, datetime, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../app/server"))
from txrv_server import SUPPORT  # noqa: E402
import score  # noqa: E402

THRESHOLDS = os.path.join(HERE, "../app/server/thresholds.json")
# txrv kind → ChestX-Det classes that make it positive. edema has no ChestX-Det label, so it stays at the default.
CXD_FOR = {
    "pneumothorax": {"Pneumothorax"}, "effusion": {"Effusion"}, "cardiomegaly": {"Cardiomegaly"}, "edema": set(),
    "nodule / mass": {"Nodule", "Mass", "Diffuse Nodule"}, "atelectasis": {"Atelectasis"}, "opacity": {"Consolidation"},
}
MIN_POS = 10
MAX_KNOTS = 8
BANNER = "!" * 78 + "\n!!  IN-SAMPLE, not a held-out estimate: no dev/test split in this manifest.\n" + "!" * 78


def kind_prob(kind, probs):
    keys = next(k for name, _, k in SUPPORT if name == kind)
    return max(probs.get(k, 0.0) for k in keys)


def finding_kind(f):
    """txrv kind of a finding: first match on the title, then title + description (as txrv_server.check)."""
    title = f.get("title", "").lower()
    for hay in (title, f"{title} {f.get('description', '').lower()}"):
        for kind, rx, _ in SUPPORT:
            if re.search(rx, hay): return kind


def youden(pairs):
    """Best threshold on a 0.05..0.95 grid (step 0.01) for (prob, label) pairs; ties go to the one nearest 0.5."""
    pos = sum(y for _, y in pairs); neg = len(pairs) - pos
    best = None
    for t in (i / 100 for i in range(5, 96)):
        tp = sum(1 for p, y in pairs if y and p >= t); tn = sum(1 for p, y in pairs if not y and p < t)
        j = tp / pos + tn / neg - 1
        if best is None or j > best[0] + 1e-12 or (abs(j - best[0]) <= 1e-12 and abs(t - 0.5) < abs(best[1] - 0.5)):
            best = (j, t)
    return round(best[1], 2)


def pav(pairs, max_knots=MAX_KNOTS):
    """Isotonic (pooled-adjacent-violators) fit of P(label | prob), as (mean prob, P) knots, non-decreasing in both.
    Blocks are then merged pairwise (smallest step in P first) until at most max_knots remain; merging adjacent
    blocks of a monotone fit keeps it monotone."""
    blocks = []  # [sum prob, sum label, count]
    for p, y in sorted(pairs):
        blocks.append([p, float(y), 1])
        while len(blocks) > 1 and blocks[-2][1] / blocks[-2][2] >= blocks[-1][1] / blocks[-1][2]:
            b = blocks.pop(); blocks[-1] = [blocks[-1][i] + b[i] for i in range(3)]
    while len(blocks) > max_knots:
        i = min(range(len(blocks) - 1), key=lambda i: blocks[i + 1][1] / blocks[i + 1][2] - blocks[i][1] / blocks[i][2])
        b = blocks.pop(i + 1); blocks[i] = [blocks[i][j] + b[j] for j in range(3)]
    return [[round(s / n, 3), round(y / n, 3)] for s, y, n in blocks]


def auc(pairs):
    """Mann-Whitney AUC (ties count half); None without both classes."""
    pos = [p for p, y in pairs if y]; neg = [p for p, y in pairs if not y]
    if not pos or not neg: return None
    return sum((p > q) + 0.5 * (p == q) for p in pos for q in neg) / (len(pos) * len(neg))


def sens_spec(pairs, t):
    tp = sum(1 for p, y in pairs if y and p >= t); pos = sum(1 for _, y in pairs if y)
    tn = sum(1 for p, y in pairs if not y and p < t); neg = len(pairs) - pos
    return (tp, pos), (tn, neg)


def stage_a(manifest, probs):
    split = {m["id"]: m.get("split") for m in manifest}
    if not any(split.values()):
        print("Stage A skipped: this manifest has no dev/test split, so thresholds would be tuned on the test images.")
        return None
    labels = {m["id"]: set(m["labels"]) for m in manifest}
    def pairs(kind, part):
        return [(kind_prob(kind, probs[i]), bool(labels[i] & CXD_FOR[kind])) for i in labels if split[i] == part and i in probs]
    kinds = {}
    for kind, _, _ in SUPPORT:
        dev = pairs(kind, "dev"); dev_pos = sum(y for _, y in dev)
        tuned = dev_pos >= MIN_POS and dev_pos < len(dev)
        kinds[kind] = {"thr": youden(dev) if tuned else 0.5, "dev_pos": dev_pos, "dev_n": len(dev), "default": not tuned,
                       "knots": pav(dev) if tuned else []}
    out = {"generated": datetime.date.today().isoformat(),
           "source": "ChestX-Det dev split, TorchXRayVision vs radiologist labels, Youden J", "kinds": kinds}
    with open(THRESHOLDS, "w") as fh:
        kinds_txt = ",\n".join(f"    {json.dumps(k)}: {json.dumps(v)}" for k, v in kinds.items())  # one kind per line
        fh.write(f'{{\n  "generated": {json.dumps(out["generated"])},\n  "source": {json.dumps(out["source"])},\n'
                 f'  "kinds": {{\n{kinds_txt}\n  }}\n}}\n')
    print(f"Stage A: wrote {os.path.relpath(THRESHOLDS)} (tuned on dev, {kinds['opacity']['dev_n']} films)\n")
    print("TEST split (held out), classifier alone. Sensitivity / specificity with Wilson 95% CIs:")
    print(f"  {'kind':14s} {'thr':>5s} {'dev+':>4s}  {'AUC':>4s}  {'sens @thr':24s} {'spec @thr':24s} {'sens @0.5':24s} {'spec @0.5':24s}")
    for kind, k in kinds.items():
        test = pairs(kind, "test"); a = auc(test)
        (s1, s2), (c1, c2) = sens_spec(test, k["thr"]), sens_spec(test, 0.5)
        tag = " (default)" if k["default"] else ""
        print(f"  {kind:14s} {k['thr']:5.2f} {k['dev_pos']:4d}  {f'{a:.2f}' if a is not None else '  — '}  "
              f"{score.wilson(*s1) or '—':24s} {score.wilson(*s2):24s} {score.wilson(*c1) or '—':24s} {score.wilson(*c2):24s}{tag}")
    return out


def fuse(med_rows, maira_rows, probs, thr, maira_kinds, filter_medgemma=False):
    """Fused rows in the results schema; returns (rows, counts). The classifier gates MAIRA-2 additions; it removes
    MedGemma findings only with filter_medgemma (off: on ChestX-Det it cost more true findings than false ones)."""
    maira = {r["id"]: r for r in maira_rows}
    n = Counter(); out = []
    for r in med_rows:
        if not r.get("final") or r["id"] not in probs:
            n["unchanged (no parse or no probabilities)"] += 1; out.append(r); continue
        p = probs[r["id"]]; fs = r["final"]["findings"]
        def ok(f):
            k = finding_kind(f)
            return f["severity"] == "normal" or k is None or kind_prob(k, p) >= thr.get(k, 0.5)
        keep = [f for f in fs if ok(f)] if filter_medgemma else fs
        dropped = [f["title"] for f in fs if f not in keep]
        have = {finding_kind(f) for f in fs if f["severity"] != "normal"}
        added = []
        for f in ((maira.get(r["id"]) or {}).get("final") or {}).get("findings", []):
            k = finding_kind(f)
            if f["severity"] != "normal" and k in maira_kinds and k not in have and ok(f):
                added.append({**f, "source": "maira2"})
        n["MedGemma findings dropped by classifier"] += len(dropped); n["MAIRA-2 findings added"] += len(added)
        out.append({**r, "final": {**r["final"], "findings": keep + added},
                    "fusion": {"dropped": dropped, "added": [f["title"] for f in added]}})
    return out, n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    manifest_path = os.environ.get("MANIFEST", "manifest-cxd.json")
    cxd = "cxd" in manifest_path
    ap.add_argument("--txrv", default=os.environ.get("TXRV", "txrv-cxd.jsonl" if cxd else "txrv.jsonl"))
    ap.add_argument("--medgemma", default="results-cxd.jsonl" if cxd else "results.jsonl")
    ap.add_argument("--maira", default="results-maira2-cxd.jsonl" if cxd else None)
    ap.add_argument("--maira-kinds", default="effusion,nodule / mass,atelectasis")
    ap.add_argument("--thr", help="thresholds.json to apply in stage B (default: stage A's output, or 0.5 in-sample)")
    ap.add_argument("--filter-medgemma", action="store_true", help="also drop MedGemma findings the classifier does not support (worse on ChestX-Det)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    os.chdir(HERE)

    manifest = json.load(open(manifest_path))
    probs = {r["id"]: r["probs"] for r in map(json.loads, open(a.txrv)) if r.get("probs")}
    held_out = any(m.get("split") for m in manifest)
    tuned = stage_a(manifest, probs)

    print()
    if not os.path.exists(a.medgemma):
        print(f"Stage B skipped: {a.medgemma} not found (MedGemma has not been run on this manifest; see run_all.sh).")
        return
    if a.thr: thr_src, thr = a.thr, {k: v["thr"] for k, v in json.load(open(a.thr))["kinds"].items()}
    elif tuned: thr_src, thr = "dev-tuned (stage A)", {k: v["thr"] for k, v in tuned["kinds"].items()}
    else: thr_src, thr = "0.5 for every kind", {}
    maira_rows = score.load(a.maira) if a.maira and os.path.exists(a.maira) else []
    if a.maira and not maira_rows: print(f"note: {a.maira} not found; fusing MedGemma with the classifier only")
    ids = {m["id"] for m in manifest}
    med = [r for r in score.load(a.medgemma) if r["id"] in ids]
    missing = len(ids - {r["id"] for r in maira_rows}) if maira_rows else 0
    if maira_rows and missing: print(f"note: {a.maira} covers {len(ids) - missing}/{len(ids)} images (partial run)")

    rows, n = fuse(med, maira_rows, probs, thr, set(a.maira_kinds.split(",")), a.filter_medgemma)
    out = a.out or ("results-fused-cxd.jsonl" if cxd else "results-fused.jsonl")
    with open(out, "w") as fh:
        for r in rows: fh.write(json.dumps(r) + "\n")
    print(f"Stage B: thresholds {thr_src}; MAIRA-2 kinds {a.maira_kinds}; wrote {out}")
    for k, v in n.items(): print(f"  {k}: {v}")
    if not held_out: print(BANNER)
    print()
    split = "test" if held_out else None
    score.report(score.score(rows, split=split), out)
    if not held_out: print("\n" + BANNER)


if __name__ == "__main__":
    main()
