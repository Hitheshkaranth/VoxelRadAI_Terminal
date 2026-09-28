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

NEG = re.compile(r"^\s*(there is |there are )?(no|without)\b|\bno (evidence|focal|acute|definite|large|significant|pleural|pneumothorax|consolidation|effusion)"
                 r"|\b(normal|unremarkable|clear|within normal limits|intact|preserved|well[- ]expanded|midline|stable)\b"
                 r"|\bnot (seen|identified|visualized|enlarged)", re.I)
DEVICE = re.compile(r"sternotomy|pacemaker|pacer|catheter|picc|\bline\b|\btube\b|clips?\b|wires?\b|port\b|stent|valve|prosthe|hardware"
                    r"|endotracheal|enteric|nasogastric|\b(ng|og|et)\b|drain|\bleads?\b|electrode|monitoring|\bicd\b|aicd|sheath", re.I)
MALPOS = re.compile(r"malposition|kink|coil|too (deep|high|low)|retracted|advanc", re.I)
# "normal" words inside an abnormality ("abnormal", "not normal") must not negate it
ABN_HINT = re.compile(r"abnormal|enlarged|increased|opacit|effusion|pneumothorax|consolidat|atelecta|edema|nodul|mass|cardiomegaly|infiltrat|thicken|fracture|elevat", re.I)


def is_normal_clause(c: str) -> bool:
    if DEVICE.search(c) and not MALPOS.search(c):
        return True
    if not NEG.search(c):
        return False
    # Within a clause, abnormal terms that all follow a negation ("normal without effusion", "No effusion") are negated;
    # otherwise a "normal" word loses to an explicit abnormal term ("normal heart; enlarged ...").
    neg = re.search(r"\b(no|without|negative for)\b", c, re.I)
    abn = [m.start() for m in ABN_HINT.finditer(c)]
    return not abn or (neg is not None and min(abn) > neg.start())


def sentence_findings(sentence: str) -> tuple[str, str]:
    """Split on contrast conjunctions; return (abnormal part, severity)."""
    clauses = [c.strip(" ,;.") for c in re.split(r",?\s*\b(?:but|however|although|though|whereas)\b|;", sentence) if c.strip(" ,;.")]
    abn = [c for c in clauses if not is_normal_clause(c)]
    return ("; ".join(abn), "minor") if abn else (sentence, "normal")


def plain_sentences(text: str) -> list[str]:
    """Fallback when MAIRA-2 emits a malformed grounded sequence (e.g. drops <obj> tags mid-report): strip tags, split."""
    text = re.sub(r"<box>.*?</box>|</?obj>", " ", text)
    return [s.strip() for s in re.split(r"(?<=\.)\s+", text) if s.strip()]


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
    manifest = json.load(open("manifest.json"))
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
                title, sev = sentence_findings(sentence)
                f = {"title": title, "description": sentence, "severity": sev, "confidence": None}
                if boxes:
                    # boxes are relative to the processor's crop; map back to the original image, normalized 0-1
                    b = [processor.adjust_box_for_original_image_size(bx, width=img.width, height=img.height) for bx in boxes]
                    f["bbox"] = {"x": b[0][0], "y": b[0][1], "w": b[0][2] - b[0][0], "h": b[0][3] - b[0][1]}
                    f["boxes"] = b
                findings.append(f)
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
