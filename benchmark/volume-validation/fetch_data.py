"""Download precisely the public evaluation files, checking recorded SHA-256 hashes."""
from pathlib import Path
import hashlib,json,urllib.request
root=Path(__file__).resolve().parent
provenance=json.loads((root/'provenance.json').read_text())
manifest=json.loads((root/'manifest.json').read_text())
(root/'data').mkdir(exist_ok=True)
for case in manifest:
    mod=case['modality']
    for kind,hash_field in [('image','imageSha256'),('mask','maskSha256')]:
        dest=root/'data'/f'{mod}-{"label" if kind=="mask" else "image"}.nii.gz'
        expected=case[hash_field]
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest()==expected:
            print('Verified existing',dest.name);continue
        temp=dest.with_suffix('.download')
        urllib.request.urlretrieve(provenance[mod][kind],temp)
        actual=hashlib.sha256(temp.read_bytes()).hexdigest()
        if actual!=expected:
            raise RuntimeError(f'Hash mismatch for {dest.name}; downloaded bytes retained as {temp.name}')
        temp.replace(dest);print('Downloaded and verified',dest.name)
