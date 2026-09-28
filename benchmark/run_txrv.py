"""TorchXRayVision cross-check over the benchmark, using the app's service code (app/server/txrv_server.py).

  python run_txrv.py                      # → txrv.jsonl (probabilities per image; needs torchxrayvision, scikit-image)
  python3 run_txrv.py --filter results.jsonl results-txrv.jsonl   # drop findings the classifier does not support
  python3 score.py final results-txrv.jsonl
"""
import json, sys
sys.path.insert(0, "../app/server")
from txrv_server import check, probabilities  # noqa: E402

if sys.argv[1:2] == ["--filter"]:
    probs = {r["id"]: r["probs"] for r in map(json.loads, open("txrv.jsonl"))}
    with open(sys.argv[3], "w") as out:
        for r in map(json.loads, open(sys.argv[2])):
            if r.get("final"):
                keep = [f for f in r["final"]["findings"] if (c := check(f, probs[r["id"]])) is None or c["supported"]]
                dropped = [f["title"] for f in r["final"]["findings"] if f not in keep]
                r["final"] = {**r["final"], "findings": keep}
                if dropped:
                    r["txrvDropped"] = dropped
                    print(f"{r['id']:14s} {','.join(r['labels']):26s} dropped: {'; '.join(dropped)}")
            out.write(json.dumps(r) + "\n")
else:
    with open("txrv.jsonl", "w") as out:
        for m in json.load(open("manifest.json")):
            p = probabilities(open(m["path"], "rb").read())
            out.write(json.dumps({"id": m["id"], "labels": m["labels"], "probs": p}) + "\n")
            print(f"{m['id']:14s} {','.join(m['labels']):26s} " + ", ".join(f"{k} {v:.2f}" for k, v in sorted(p.items(), key=lambda kv: -kv[1])[:3]), flush=True)
