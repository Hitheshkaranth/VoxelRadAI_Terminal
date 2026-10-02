"""Pure (stdlib-only) helpers that turn MAIRA-2's free-text Findings into app findings.

Shared by benchmark/run_maira2.py and app/server/maira_server.py so the benchmark scores exactly what the app shows.
MAIRA-2 writes one sentence per observation (optionally with boxes); negated sentences and normal anatomy /
well-positioned devices become severity "normal" (mirrors the app's rule).
"""
import re

NEG = re.compile(r"^\s*(there is |there are )?(no|without)\b|\bno (evidence|focal|acute|definite|large|significant|pleural|pneumothorax|consolidation|effusion)"
                 r"|\b(normal|unremarkable|clear|within normal limits|intact|preserved|well[- ]expanded|midline|stable)\b"
                 r"|\bnot (\w+ )?(seen|identified|visualized|enlarged)", re.I)
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
    # "not" negates only an abnormal term right after it ("not enlarged"), not a sentence ("not clear, with opacities")
    neg = re.search(r"\b(no|without|negative for)\b|\bnot\s+(?:\w+\s+)?(?=" + ABN_HINT.pattern + ")", c, re.I)
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


def box_to_bbox(boxes: list) -> dict | None:
    """First [x0, y0, x1, y1] box (normalized to the original image) → the app's {x, y, w, h}."""
    if not boxes:
        return None
    b = boxes[0]
    return {"x": b[0], "y": b[1], "w": b[2] - b[0], "h": b[3] - b[1]}


def to_finding(sentence: str, boxes: list | None = None) -> dict:
    """One generated sentence (plus its boxes, already mapped to the original image) → a benchmark/app finding."""
    title, sev = sentence_findings(sentence)
    f = {"title": title, "description": sentence, "severity": sev, "confidence": None}
    if boxes:
        f["bbox"] = box_to_bbox(boxes)
        f["boxes"] = boxes
    return f
