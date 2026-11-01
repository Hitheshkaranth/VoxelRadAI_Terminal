from pathlib import Path
import nibabel as nib, numpy as np, gzip,json,hashlib
from PIL import Image
root=Path(__file__).resolve().parent;data=root/'data';manifest=[]
for mod,case,maskval in [('ct','liver_0',2),('mri','BraTS-GLI-00000-000',None)]:
 image=nib.load(data/f'{mod}-image.nii.gz');label=nib.load(data/f'{mod}-label.nii.gz')
 a=np.asanyarray(image.dataobj);m=np.asanyarray(label.dataobj)
 assert a.shape==m.shape and np.allclose(image.affine,label.affine,atol=1e-5)
 assert np.all(a==np.round(a)); a=a.astype('<i4');m=m.astype('uint8')
 affine=np.diag([-1,-1,1,1])@image.affine
 def write_nrrd(name,arr,kind):
  vec=lambda v:'('+','.join(str(float(x)) for x in v)+')'
  header='\n'.join(['NRRD0005','type: '+kind,'dimension: 3','space: left-posterior-superior','sizes: '+' '.join(map(str,arr.shape)),'space directions: '+' '.join(vec(affine[:3,i]) for i in range(3)),'space origin: '+vec(affine[:3,3]),'encoding: gzip','endian: little','',''])
  (data/name).write_bytes(header.encode()+gzip.compress(arr.tobytes(order='F'),compresslevel=1))
 write_nrrd(f'{mod}.nrrd',a,'int');write_nrrd(f'{mod}-mask.nrrd',m,'uchar')
 target=m==maskval if maskval else m>0;counts=target.sum((0,1));positive=np.flatnonzero(counts)
 peak=int(np.argmax(counts));positive_tests=sorted(set([int(positive[len(positive)//4]),peak,int(positive[3*len(positive)//4])]))
 content=(a>0).sum((0,1));neg=[int(k) for k in np.flatnonzero(counts==0) if content[k]>.6*content.max()];negative=min(neg,key=lambda k:abs(k-peak))
 window={'center':50,'width':400} if mod=='ct' else {'center':float(np.percentile(a[a>0],99)/2),'width':float(np.percentile(a[a>0],99))}
 slices=[]
 for z in positive_tests+[negative]:
  # Exact orientation used by app getSliceGeometry for axis-aligned axial data.
  flipx=affine[0,0]<0;flipy=affine[1,1]<0
  arr=a[:,:,z].T;mask=target[:,:,z].T
  if flipx:arr=arr[:,::-1];mask=mask[:,::-1]
  if flipy:arr=arr[::-1,:];mask=mask[::-1,:]
  grey=np.clip(np.floor((arr-(window['center']-window['width']/2))*255/window['width']+.5),0,255).astype('uint8')
  Image.fromarray(grey).save(data/f'{mod}-slice-{z+1}.png');Image.fromarray(mask.astype('uint8')*255).save(data/f'{mod}-reference-{z+1}.png')
  coords=np.argwhere(mask);bbox=None
  if len(coords):
   lo=coords.min(0);hi=coords.max(0)+1;bbox={'x':float(lo[1]/mask.shape[1]),'y':float(lo[0]/mask.shape[0]),'w':float((hi[1]-lo[1])/mask.shape[1]),'h':float((hi[0]-lo[0])/mask.shape[0])}
  slices.append({'index':z,'number':z+1,'positive':bool(len(coords)),'referencePixels':len(coords),'bbox':bbox})
 manifest.append({'modality':mod,'case':case,'dimensions':list(a.shape),'window':window,'slices':slices,'peak':peak+1,'affineLPS':affine.tolist(),'imageSha256':hashlib.sha256((data/f'{mod}-image.nii.gz').read_bytes()).hexdigest(),'maskSha256':hashlib.sha256((data/f'{mod}-label.nii.gz').read_bytes()).hexdigest(),'maskTarget':'label 2 liver tumor' if mod=='ct' else 'union of labels 1, 2, 3 tumor-associated regions','selection':'Three positive slices selected from reference extent and peak area, plus nearest non-target slice with sufficient image content; selection fixed before inference.'})
(root/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
