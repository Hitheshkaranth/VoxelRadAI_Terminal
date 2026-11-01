from pathlib import Path
import json, numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import binary_erosion
root=Path(__file__).resolve().parent
records=json.loads((root/'normalized-results.json').read_text());scored=[]
F=next((str(p) for p in [Path('/System/Library/Fonts/Supplemental/Arial.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if p.exists()),'DejaVuSans.ttf')
for r in records:
 mod=r['modality'];z=r['slice'];image=Image.open(root/f'data/{mod}-slice-{z}.png').convert('RGB');mask=np.asarray(Image.open(root/f'data/{mod}-reference-{z}.png'))>0
 raw=r.get('analysis');findings=[] if not raw else [f for f in raw['findings'] if f['severity']!='normal']
 # Keep the app's normalized coordinates exactly. No post-hoc axis swaps or label-driven corrections.
 candidate=np.zeros(mask.shape,dtype=bool);boxes=[]
 for f in findings:
  b=f.get('bbox')
  if not b:continue
  x0=max(0,int(np.floor(b['x']*mask.shape[1])));y0=max(0,int(np.floor(b['y']*mask.shape[0])))
  x1=min(mask.shape[1],int(np.ceil((b['x']+b['w'])*mask.shape[1])));y1=min(mask.shape[0],int(np.ceil((b['y']+b['h'])*mask.shape[0])))
  candidate[y0:y1,x0:x1]=True;boxes.append([x0,y0,x1,y1])
 intersection=int((candidate&mask).sum());union=int((candidate|mask).sum())
 scores={'case':r['case'],'modality':mod,'slice':z,'referencePositive':bool(mask.any()),'reportedAbnormal':bool(findings) if raw else None,'modelFindings':[f['title'] for f in findings],'impression':raw.get('impression') if raw else None,'returnedBoxes':len(boxes),'referencePixels':int(mask.sum()),'candidateBoxPixels':int(candidate.sum()),'intersectionPixels':intersection,'boxToReferenceMaskIoU':intersection/union if boxes and union else None,'referenceCoverageByBoxes':intersection/int(mask.sum()) if boxes and mask.any() else None,'appFlagged':'Unverified model claim' in r['ui'],'truncated':raw.get('truncated',False) if raw else None,'identityVerified':r.get('resultLabel','').find('axial '+str(z)+'/')>=0}
 scored.append(scores)
 # Scientific comparison panels from source pixels and untouched coordinates.
 scale=2 if image.width<400 else 1
 im=image.resize((640,640));arr=np.asarray(image).copy();edge=mask&~binary_erosion(mask);arr[edge]=[99,224,194]
 overlay=Image.fromarray(arr).resize((640,640));d=ImageDraw.Draw(overlay)
 for b in boxes:d.rectangle(tuple(int(v*640/image.width) for v in b),outline='#ffb578',width=3)
 out=Image.new('RGB',(1440,850),'#101216');dr=ImageDraw.Draw(out)
 dr.text((48,24),f'{mod.upper()}  |  Axial slice {z}',font=ImageFont.truetype(F,32),fill='#f0f1f3')
 out.paste(im,(48,110));out.paste(overlay,(752,110))
 dr.text((48,76),'Original image',font=ImageFont.truetype(F,22),fill='#aab0ba');dr.text((752,76),'Reference contour + raw model box',font=ImageFont.truetype(F,22),fill='#aab0ba')
 dr.text((48,785),'Green: reference mask',font=ImageFont.truetype(F,24),fill='#63e0c2');dr.text((752,785),'Amber: model candidate (not accepted)',font=ImageFont.truetype(F,24),fill='#ffb578')
 out.save(root/f'{mod}-{z}-comparison.png')
(root/'scores.json').write_text(json.dumps(scored,indent=2));print(json.dumps(scored,indent=2))
