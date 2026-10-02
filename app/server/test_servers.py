"""Unit tests for the cross-check and second-reader services; no torch, no ports, no model calls.

  python3 -m unittest app/server/test_servers.py
"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import maira_parse  # noqa: E402
import maira_server  # noqa: E402
import txrv_server  # noqa: E402
from txrv_server import calibrate, check  # noqa: E402

PROBS = {"Effusion": 0.42, "Nodule": 0.2, "Mass": 0.1, "Lung Lesion": 0.15, "Atelectasis": 0.3, "Pneumothorax": 0.7}
TUNED = {"effusion": {"thr": 0.35, "dev_pos": 20, "dev_n": 106, "default": False, "knots": [[0.1, 0.05], [0.5, 0.4], [0.9, 0.9]]}}

# Stored raw output for nih_0 from benchmark/results-maira2.jsonl.
RAW = ("<obj> Left-sided picc terminates in the upper to mid svc.</obj><obj> The heart size is normal.</obj><obj> Mediastinal and hilar "
       "contours are unremarkable.</obj><obj> Linear opacities in the right lung base are compatible with subsegmental atelectasis."
       "<box><x9><y55><x38><y80></box></obj><obj> No focal consolidation.</obj><obj> No pleural effusion.</obj><obj> No pneumothorax."
       "</obj><obj> No acute osseous abnormalities.</obj><obj> Surgical clips are seen in the right upper quadrant of the abdomen."
       "<box><x27><y90><x27><y99></box></obj>")


def f(title, description="", severity="moderate"):
    return {"title": title, "description": description, "severity": severity}


class CheckTest(unittest.TestCase):
    def test_default_threshold(self):
        c = check(f("Left pleural effusion"), PROBS, {})
        self.assertEqual((c["kind"], c["thr"], c["thrSource"], c["supported"]), ("effusion", 0.5, "default", False))
        self.assertNotIn("calibrated", c)

    def test_tuned_threshold_and_calibration(self):
        c = check(f("Left pleural effusion"), PROBS, TUNED)
        self.assertEqual((c["thr"], c["thrSource"], c["supported"]), (0.35, "tuned", True))
        # 0.42 lies between knots (0.1, 0.05) and (0.5, 0.4): 0.05 + 0.35 * 0.32 / 0.4 = 0.33
        self.assertAlmostEqual(c["calibrated"], 0.33, places=3)

    def test_default_flag_in_file(self):
        c = check(f("Left pleural effusion"), PROBS, {"effusion": {"thr": 0.5, "default": True}})
        self.assertEqual(c["thrSource"], "default")

    def test_calibrate_clamps(self):
        knots = [[0.2, 0.1], [0.8, 0.7]]
        self.assertEqual(calibrate(0.0, knots), 0.1)
        self.assertEqual(calibrate(1.0, knots), 0.7)
        self.assertAlmostEqual(calibrate(0.5, knots), 0.4)
        self.assertIsNone(calibrate(0.5, []))

    def test_mass_effect_is_not_a_nodule(self):
        self.assertIsNone(check(f("Mediastinal shift", "mass effect on the trachea"), PROBS, {}))
        self.assertEqual(check(f("Right upper lobe mass"), PROBS, {})["kind"], "nodule / mass")
        self.assertEqual(check(f("Pulmonary nodule"), PROBS, {})["kind"], "nodule / mass")

    def test_not_covered(self):
        c = check(f("Healed rib fracture"), PROBS, {})
        self.assertEqual(c, {"kind": "fracture", "prob": None, "supported": None, "reason": "not covered"})
        self.assertEqual(check(f("Malpositioned endotracheal tube"), PROBS, {})["kind"], "tube")

    def test_normal_and_unrelated(self):
        self.assertIsNone(check(f("Left pleural effusion", severity="normal"), PROBS, {}))
        self.assertIsNone(check(f("Widened mediastinum"), PROBS, {}))

    def test_module_thresholds_used_when_none(self):
        saved = txrv_server.THRESHOLDS
        try:
            txrv_server.THRESHOLDS = TUNED
            self.assertEqual(check(f("Effusion"), PROBS)["thrSource"], "tuned")
        finally:
            txrv_server.THRESHOLDS = saved


class MairaParseTest(unittest.TestCase):
    def test_plain_sentences(self):
        s = maira_parse.plain_sentences(RAW)
        self.assertEqual(len(s), 9)
        self.assertEqual(s[3], "Linear opacities in the right lung base are compatible with subsegmental atelectasis.")

    def test_not_negation(self):
        sev = lambda t: maira_parse.sentence_findings(t)[1]
        self.assertEqual(sev("The cardiac silhouette is not enlarged."), "normal")
        self.assertEqual(sev("Heart size is not significantly enlarged."), "normal")
        self.assertEqual(sev("Lungs are not clear, with bibasilar opacities."), "minor")
        self.assertEqual(sev("The heart is enlarged."), "minor")

    def test_sentence_findings(self):
        sev = [maira_parse.sentence_findings(s)[1] for s in maira_parse.plain_sentences(RAW)]
        # only the atelectasis sentence is abnormal; the PICC and clips are well-positioned devices
        self.assertEqual(sev, ["normal", "normal", "normal", "minor", "normal", "normal", "normal", "normal", "normal"])
        self.assertEqual(maira_parse.sentence_findings("Heart size is normal, but there is a small left effusion.")[0],
                         "there is a small left effusion")

    def test_to_finding_box(self):
        out = maira_parse.to_finding("Small left effusion.", [[0.1, 0.5, 0.4, 0.8]])
        self.assertEqual(out["severity"], "minor")
        self.assertAlmostEqual(out["bbox"]["w"], 0.3)
        self.assertNotIn("bbox", maira_parse.to_finding("No effusion."))


class MairaServerTest(unittest.TestCase):
    def test_no_torch_at_import(self):
        self.assertNotIn("torch", sys.modules)
        self.assertFalse(maira_server._state["model"])

    def test_report_requires_load(self):
        self.assertEqual(maira_server.report(b"")[0], 409)

    def test_load_refuses_while_lmstudio_resident(self):
        saved = maira_server.lmstudio_loaded
        try:
            maira_server.lmstudio_loaded = lambda url=None: ["medgemma-27b-it"]
            code, body = maira_server.load()
            self.assertEqual(code, 409)
            self.assertIn("medgemma-27b-it", body["message"])
        finally:
            maira_server.lmstudio_loaded = saved
        self.assertNotIn("torch", sys.modules)

    def test_unload_when_not_loaded(self):
        self.assertEqual(maira_server.unload(), (200, {"ok": True, "message": "not loaded"}))


if __name__ == "__main__":
    unittest.main()
