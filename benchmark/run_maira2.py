"""Runs microsoft/maira-2 over the benchmark manifest and writes results in the same schema as run.mts,
so `python3 score.py final results-maira2.jsonl` scores it identically.

MAIRA-2 is not a chat model: it writes a free-text Findings section (optionally one box per sentence), so
it cannot use the app's prompts. Each generated sentence becomes a finding; sentences that are negated or
describe normal anatomy / well-positioned devices are marked severity "normal" (mirrors the app's rule).

Needs transformers 4.4x-4.51 (MAIRA-2 remote code) and the weights (accepted license). Resumable.
  python run_maira2.py [--no-grounding]
  python3 run_maira2.py --rescore results-maira2.jsonl   # re-classify stored sentences after rule changes (no model)
"""
import json, os, re, sys, time

GROUNDED = "--no-grounding" not in sys.argv
OUT = os.environ.get("OUT", "results-maira2.jsonl" if GROUNDED else "results-maira2-plain.jsonl")
MODEL = os.environ.get("MAIRA_PATH", os.path.expanduser("~/.cache/maira-2"))  # or "microsoft/maira-2" when logged in

# Sentence → finding rules live in app/server/maira_parse.py so the app's second reader matches the benchmark.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "server"))
from maira_parse import plain_sentences, sentence_findings, to_finding  # noqa: E402


def as_result(findings: list, parse: str) -> dict:
    return {"parse": parse, "main": {"findings": findings, "impression": ""}, "final": {"findings": findings, "impression": ""}}


def rescore(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    for r in rows:
        if r.get("raw") and not r.get("final"):  # rows that failed before the fallback existed
            r.pop("error", None)
            r.update(as_result([{"title": s, "description": s, "severity": "", "confidence": None} for s in plain_sentences(r["raw"])], "fallback"))
        for f in (r.get("final") or {}).get("findings", []):
            f["title"], f["severity"] = sentence_findings(f["description"])
    open(path, "w").write("".join(json.dumps(r) + "\n" for r in rows))
    print(f"re-classified {len(rows)} rows in {path}")


def main():
    import torch
    from PIL import Image
    from transformers import AutoModelForCausalLM, AutoProcessor
    DEV = "mps" if torch.backends.mps.is_available() else "cpu"
    manifest = json.load(open(os.environ.get("MANIFEST", "manifest.json")))
    done = set()
    if os.path.exists(OUT):
        done = {json.loads(l)["id"] for l in open(OUT) if l.strip()}
    t = time.time()
    processor = AutoProcessor.from_pretrained(MODEL, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL, trust_remote_code=True, torch_dtype=torch.bfloat16).to(DEV).eval()
    print(f"loaded on {DEV} in {time.time() - t:.0f}s, grounded={GROUNDED} → {OUT}", flush=True)

    for m in manifest:
        if m["id"] in done:
            continue
        img = Image.open(m["path"]).convert("RGB")
        view = m.get("view") or ""
        technique = f"{view} view of the chest." if view in ("PA", "AP") else "Frontal view of the chest."
        t0 = time.time()
        rec = {"id": m["id"], "source": m["source"], "labels": m["labels"]}
        try:
            inputs = processor.format_and_preprocess_reporting_input(
                current_frontal=img, current_lateral=None, prior_frontal=None, prior_report=None,
                indication=None, technique=technique, comparison="None.", return_tensors="pt", get_grounding=GROUNDED,
            ).to(DEV)
            max_new = 450 if GROUNDED else 300
            with torch.no_grad():
                out = model.generate(**inputs, max_new_tokens=max_new, use_cache=True)
            gen = out[0][inputs["input_ids"].shape[-1]:]
            rec["tokens"] = int(gen.shape[-1])
            rec["finish"] = "length" if rec["tokens"] >= max_new else "stop"
            text = processor.decode(gen, skip_special_tokens=True).lstrip()
            rec["raw"] = text
            try:
                pred = processor.convert_output_to_plaintext_or_grounded_sequence(text)
                pieces = pred if GROUNDED else [(s, None) for s in re.split(r"(?<=\.)\s+", pred) if s.strip()]
                parse = "ok"
            except AssertionError:
                pieces, parse = [(s, None) for s in plain_sentences(text)], "fallback"
            findings = []
            for sentence, boxes in pieces:
                # boxes are relative to the processor's crop; map back to the original image, normalized 0-1
                b = [processor.adjust_box_for_original_image_size(bx, width=img.width, height=img.height) for bx in boxes or []]
                findings.append(to_finding(sentence, b))
            rec.update(as_result(findings, parse))
            rec["mainMs"] = int((time.time() - t0) * 1000)
        except Exception as e:  # noqa: BLE001 — record and continue
            rec["error"] = f"{type(e).__name__}: {e}"[:300]
        rec["totalMs"] = int((time.time() - t0) * 1000)
        with open(OUT, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
        abn = [f["title"] for f in (rec.get("final") or {}).get("findings", []) if f["severity"] != "normal"]
        print(f"{m['id']:14s} {','.join(m['labels']):28s} {rec['totalMs'] / 1000:.0f}s → {'; '.join(abn) or rec.get('error') or '(normal)'}", flush=True)


if __name__ == "__main__":
    rescore(sys.argv[2]) if sys.argv[1:2] == ["--rescore"] else main()
