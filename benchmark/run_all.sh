#!/usr/bin/env bash
# Full ChestX-Det benchmark, one model resident at a time (24 GB unified memory: MedGemma 27B ~16 GB and MAIRA-2
# bf16 ~14 GB cannot be loaded together, and nothing else should be loaded in LM Studio while they run).
#
#   ./run_all.sh                     # MedGemma × RUNS, then MAIRA-2, then the CPU scoring steps
#   RUNS=3 ./run_all.sh              # three MedGemma runs, for run-to-run variance (score.py prints mean [min–max])
#   ./run_all.sh --force-unload      # unload whatever LM Studio has loaded instead of refusing
#
# Env: MANIFEST (manifest-cxd.json), RUNS (1), MODEL (medgemma-27b-it), PYTHON (python, needs MAIRA-2's deps).
# Every step is resumable: run.mts and run_maira2.py skip ids already in their output file.
set -euo pipefail
cd "$(dirname "$0")"

MANIFEST="${MANIFEST:-manifest-cxd.json}"
RUNS="${RUNS:-1}"
MODEL="${MODEL:-medgemma-27b-it}"
PYTHON="${PYTHON:-python}"
FORCE=0
[[ "${1:-}" == "--force-unload" ]] && FORCE=1
export MANIFEST

# Identifiers of the models LM Studio has loaded, one per line (empty when none).
loaded() {
  lms ps --json 2>/dev/null | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for m in d if isinstance(d, list) else d.get("models", []):
    print(m.get("identifier") or m.get("modelKey") or m.get("path") or "")' || true
}

wait_unloaded() {
  for _ in $(seq 1 60); do
    [[ -z "$(loaded)" ]] && return 0
    sleep 2
  done
  echo "LM Studio still reports loaded models after 2 minutes: $(loaded | tr '\n' ' ')" >&2
  exit 1
}

# --- preflight: never unload somebody else's model silently ------------------------------------------------------
command -v lms >/dev/null || { echo "lms (LM Studio CLI) not found on PATH" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "$MANIFEST missing: python3 fetch.py chestxdet" >&2; exit 1; }
others="$(loaded | grep -vx "$MODEL" || true)"
if [[ -n "$others" ]]; then
  if [[ "$FORCE" == 1 ]]; then
    echo "Unloading (--force-unload): $(echo "$others" | tr '\n' ' ')"
    lms unload --all
    wait_unloaded
  else
    echo "LM Studio has other models loaded: $(echo "$others" | tr '\n' ' ')" >&2
    echo "Unload them yourself, or re-run with --force-unload. Nothing was changed." >&2
    exit 1
  fi
fi

# --- 1. MedGemma via LM Studio, RUNS times ----------------------------------------------------------------------
# loading an already-loaded model would add a second copy, so only load when it is not resident
loaded | grep -qx "$MODEL" || lms load "$MODEL" --context-length 16384 -y
for i in $(seq 1 "$RUNS"); do
  echo "=== MedGemma run $i/$RUNS → results-cxd-r$i.jsonl"
  OUT="results-cxd-r$i.jsonl" MODEL="$MODEL" node --experimental-strip-types run.mts
done
cp results-cxd-r1.jsonl results-cxd.jsonl  # fuse.py's default input

# --- 2. free the GPU before MAIRA-2 -----------------------------------------------------------------------------
lms unload --all
wait_unloaded

# --- 3. MAIRA-2 via transformers on MPS --------------------------------------------------------------------------
PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 OUT=results-maira2-cxd.jsonl "$PYTHON" run_maira2.py

# --- 4. CPU only: classifier, fusion, scores, app table ----------------------------------------------------------
[[ -f txrv-cxd.jsonl ]] || TXRV=txrv-cxd.jsonl uv run --with torchxrayvision --with scikit-image run_txrv.py
python3 fuse.py | tee scores-cxd.txt
for f in results-cxd-r*.jsonl results-maira2-cxd.jsonl results-fused-cxd.jsonl; do
  python3 score.py final "$f" --split test | tee -a scores-cxd.txt
done
if [[ "$RUNS" -gt 1 ]]; then
  # shellcheck disable=SC2046
  python3 score.py final $(ls results-cxd-r*.jsonl) --split test | tail -n 20 | tee -a scores-cxd.txt
fi
python3 score.py final results-cxd-r1.jsonl --split test --emit-ts ../app/src/lib/reliability.generated.ts \
  --label "ChestX-Det test · held-out · $(date +'%b %Y')"
echo "Done. Scores in scores-cxd.txt; app table regenerated (review the diff before committing)."
