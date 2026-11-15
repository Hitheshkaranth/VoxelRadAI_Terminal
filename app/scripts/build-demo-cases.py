"""Builds public/demo/: four held-out ChestX-Det films with Skanda's recorded replies from the benchmark run.

The replies are copied verbatim (boxes and outline masks included); the app parses them with its own normalizer.
Run from app/: python3 scripts/build-demo-cases.py
"""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'app' / 'public' / 'demo'
RESULTS = ROOT / 'benchmark' / 'results-skanda-manifest-cxd.jsonl'
CASES = [  # all from the held-out test split; includes a miss and a false alarm on purpose
    ('cxd_45707', 'Consolidation and effusion', 'Skanda reports both radiologist-labelled findings.'),
    ('cxd_61979', 'Diffuse nodules', 'Skanda reports bilateral diffuse nodular opacities.'),
    ('cxd_67569', 'Effusion, consolidation, enlarged heart', 'Skanda finds the effusions and consolidation but misses the cardiomegaly.'),
    ('cxd_41481', 'Enlarged cardiac silhouette', 'Skanda outlines the heart and reports cardiomegaly.'),
    ('cxd_59521', 'Normal film', 'No finding in the reference, and none reported.'),
    ('cxd_40873', 'Normal film, false alarm', 'No finding in the reference, but Skanda reports bilateral pleural effusions.'),
]

rows = {r['id']: r for r in map(json.loads, RESULTS.read_text().splitlines())}
manifest = json.loads((ROOT / 'benchmark' / 'manifest-cxd.json').read_text())
items = manifest if isinstance(manifest, list) else next(v for v in manifest.values() if isinstance(v, list))
split = {item['id']: item.get('split') for item in items if isinstance(item, dict)}
OUT.mkdir(parents=True, exist_ok=True)
cases = []
for case_id, title, note in CASES:
    row = rows[case_id]
    labels = row['labels'] if isinstance(row['labels'], list) else json.loads(row['labels'].replace("'", '"'))
    json.loads(row['raw'])  # fail loudly if a recorded reply is not valid JSON
    assert split[case_id] == 'test', f'{case_id} is not in the held-out test split'
    shutil.copyfile(ROOT / 'benchmark' / 'img' / f'{case_id}.jpg', OUT / f'{case_id}.jpg')
    cases.append({'id': case_id, 'title': title, 'note': note, 'labels': labels, 'image': f'/demo/{case_id}.jpg',
                  'width': 1024, 'height': 1024, 'raw': row['raw'], 'durationMs': int(row['mainMs'])})
(OUT / 'cases.json').write_text(json.dumps({'source': 'ChestX-Det held-out test split; recorded Skanda replies from benchmark/results-skanda-manifest-cxd.jsonl', 'cases': cases}, indent=1))
print(f'wrote {len(cases)} cases to {OUT}')
