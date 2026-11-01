"""Check saved result identity and independently recalculate spatial evidence. No model calls."""
from pathlib import Path
import json,math
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parent
records=json.loads((root/'app-results.json').read_text())
scores=json.loads((root/'scores.json').read_text())
manifest=json.loads((root/'manifest.json').read_text())
assert len(records)==len(scores)==8
expected={(c['modality'],s['number']) for c in manifest for s in c['slices']}
assert {(r['modality'],r['slice']) for r in records}==expected
assert {(s['modality'],s['slice']) for s in scores}==expected
for r in records:
    key=(r['modality'],r['slice']);a=r['analysis'];assert a and a['rawText']
    for field in ['requestLabel','resultLabel']:
        assert f'axial {r["slice"]}/' in r[field],(key,field)
    mask=np.asarray(Image.open(root/'data'/f'{key[0]}-reference-{key[1]}.png'))>0
    image=Image.open(root/'data'/f'{key[0]}-slice-{key[1]}.png')
    assert image.size==(mask.shape[1],mask.shape[0])
    assert int(mask.sum())==r['reference']['referencePixels']
    boxes=np.zeros_like(mask);count=0
    findings=[f for f in a['findings'] if f['severity']!='normal']
    for f in findings:
        b=f.get('bbox')
        if b is None:continue
        count+=1
        left=math.floor(b['x']*mask.shape[1]);top=math.floor(b['y']*mask.shape[0])
        right=math.ceil((b['x']+b['w'])*mask.shape[1]);bottom=math.ceil((b['y']+b['h'])*mask.shape[0])
        boxes[max(0,top):min(bottom,mask.shape[0]),max(0,left):min(right,mask.shape[1])]=True
    intersection=int(np.count_nonzero(mask&boxes));union=int(np.count_nonzero(mask|boxes))
    score=next(s for s in scores if (s['modality'],s['slice'])==key)
    assert score['identityVerified']
    assert score['reportedAbnormal']==bool(findings)
    assert score['referencePositive']==bool(mask.any())
    assert score['returnedBoxes']==count
    assert score['referencePixels']==int(mask.sum())
    assert score['candidateBoxPixels']==int(boxes.sum())
    assert score['intersectionPixels']==intersection
    iou=intersection/union if count and union else None
    assert score['boxToReferenceMaskIoU']==iou
    assert score['appFlagged']==any(f.get('validationIssues') for f in a['findings'])
print('PASS: 8 saved request/result identities and all reference overlap scores verified.')
