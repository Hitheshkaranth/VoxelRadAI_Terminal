"""Unit tests for the scorer and the fusion/threshold helpers (stdlib only, no model).

  python3 -m unittest benchmark/test_score.py
"""
import io, os, subprocess, sys, tempfile, unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fuse, score  # noqa: E402


def f(title, description="", severity="moderate", bbox=None):
    return {"title": title, "description": description, "severity": severity, **({"bbox": bbox} if bbox else {})}


class Wilson(unittest.TestCase):
    def test_known_bounds(self):
        lo, hi = score.wilson_ci(1, 6)  # 17%, CI 3–56 in the committed 56-image scores
        self.assertAlmostEqual(lo, 0.0301, places=3)
        self.assertAlmostEqual(hi, 0.5635, places=3)
        self.assertEqual(score.wilson(1, 6), "1/6 (17%, CI 3–56)")

    def test_edges(self):
        self.assertEqual(score.wilson_ci(0, 0), (0.0, 1.0))
        self.assertEqual(score.wilson(0, 0), "")
        lo, hi = score.wilson_ci(5, 5)
        self.assertEqual(hi, 1.0)
        self.assertGreater(lo, 0.5)
        self.assertEqual(score.wilson_ci(0, 4)[0], 0.0)


class FindingType(unittest.TestCase):
    def test_title_beats_description_and_order(self):
        self.assertEqual(score.ftype(f("Pleural effusion with consolidation")), "effusion")
        self.assertEqual(score.ftype(f("Right lower lobe consolidation", "could be atelectasis or effusion")),
                         "consolidation / opacity")
        self.assertEqual(score.ftype(f("Left pneumothorax", "with small effusion")), "pneumothorax")

    def test_description_used_when_title_unspecific(self):
        self.assertEqual(score.ftype(f("Left base abnormality", "small pleural effusion")), "effusion")
        self.assertIsNone(score.ftype(f("Sternotomy wires")))


class Inside(unittest.TestCase):
    gt = {"label": "Nodule", "x": 0.2, "y": 0.2, "w": 0.2, "h": 0.2}

    def test_centre_rule(self):
        self.assertTrue(score.inside(f("x", bbox={"x": 0.25, "y": 0.25, "w": 0.1, "h": 0.1}), self.gt))
        self.assertFalse(score.inside(f("x", bbox={"x": 0.6, "y": 0.6, "w": 0.1, "h": 0.1}), self.gt))

    def test_degenerate_boxes(self):
        self.assertIsNone(score.inside(f("x", bbox={"x": 0.3, "y": 0.3, "w": 0.0, "h": 0.1}), self.gt))
        self.assertIsNone(score.inside(f("x", bbox={"x": 0, "y": 0, "w": None, "h": None}), self.gt))
        self.assertIsNone(score.inside(f("x"), self.gt))
        zero = {**self.gt, "w": 0.005}
        self.assertFalse(score.inside(f("x", bbox={"x": 0.2, "y": 0.25, "w": 0.01, "h": 0.1}), zero))


class Score(unittest.TestCase):
    def test_counts_and_finding_level_groups(self):
        rows = [
            {"id": "a", "labels": ["Effusion"], "final": {"findings": [f("Right effusion"), f("Left effusion"),
                                                                          {**f("Atelectasis"), "source": "maira2"}]}},
            {"id": "b", "labels": ["No Finding"], "final": {"findings": [f("Heart normal", severity="normal")]}},
            {"id": "c", "labels": ["No Finding"], "final": {"findings": [f("Right lower lobe consolidation")]}},
        ]
        M = score.score(rows)
        self.assertEqual(M["flagged"], (1, 1))
        self.assertEqual(M["clear"], (1, 2))
        self.assertEqual(M["prec"]["effusion"], [1, 1])  # image-level: one per image
        self.assertEqual(M["fprec"]["all"]["effusion"], [2, 2])  # finding-level: both sides count
        self.assertEqual(M["fprec"]["maira2"]["atelectasis"], [0, 1])


class Fusion(unittest.TestCase):
    def test_pav_monotone_and_capped(self):
        pairs = [(i / 50, (i * 7919) % 11 < i / 5) for i in range(50)]
        knots = fuse.pav(pairs)
        self.assertLessEqual(len(knots), fuse.MAX_KNOTS)
        for (p0, q0), (p1, q1) in zip(knots, knots[1:]):
            self.assertLess(p0, p1)
            self.assertLessEqual(q0, q1)

    def test_pav_pools_violators(self):
        self.assertEqual(fuse.pav([(0.1, 0), (0.2, 1), (0.3, 0), (0.4, 1)]), [[0.1, 0.0], [0.25, 0.5], [0.4, 1.0]])

    def test_youden_picks_the_separating_threshold(self):
        pairs = [(p, False) for p in (0.1, 0.2, 0.3, 0.35)] + [(p, True) for p in (0.61, 0.7, 0.8, 0.9)]
        t = fuse.youden(pairs)  # J = 1 for any t in (0.35, 0.61]; ties go to the one nearest 0.5
        self.assertEqual(t, 0.5)
        pairs = [(p, False) for p in (0.1, 0.2, 0.62, 0.65)] + [(p, True) for p in (0.7, 0.8, 0.9, 0.95)]
        self.assertEqual(fuse.youden(pairs), 0.66)

    def test_auc(self):
        self.assertEqual(fuse.auc([(0.9, True), (0.1, False)]), 1.0)
        self.assertEqual(fuse.auc([(0.5, True), (0.5, False)]), 0.5)
        self.assertIsNone(fuse.auc([(0.5, True)]))

    def test_no_split_skips_tuning(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertIsNone(fuse.stage_a([{"id": "x", "labels": ["No Finding"]}], {}))
        self.assertIn("skipped", buf.getvalue())

    def test_in_sample_banner(self):
        with tempfile.TemporaryDirectory() as d:
            out = subprocess.run(
                [sys.executable, os.path.join(HERE, "fuse.py"), "--medgemma", "results.jsonl", "--maira",
                 "results-maira2.jsonl", "--txrv", "txrv.jsonl", "--out", os.path.join(d, "fused.jsonl")],
                cwd=HERE, env={**os.environ, "MANIFEST": "manifest.json"}, capture_output=True, text=True, check=True).stdout
        self.assertIn("IN-SAMPLE, not a held-out estimate", out)
        self.assertIn("Stage A skipped", out)
        self.assertIn("scoring 'final' on 56 images", out)


if __name__ == "__main__":
    unittest.main()
