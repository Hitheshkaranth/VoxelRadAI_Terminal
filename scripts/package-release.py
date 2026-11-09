"""Package a clean tagged checkout and its freshly built local frontend."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'app/package.json').read_text())['version']
tag = f'v{version}'
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit changes before packaging.')
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).strip()
tag_head = subprocess.check_output(['git', 'rev-list', '-n', '1', tag], cwd=root).strip()
if head != tag_head:
    raise SystemExit('HEAD must match the release tag.')
out = root / 'output/releases' / tag
out.mkdir(parents=True, exist_ok=True)
prefix = f'skanda-radiology-{tag}'
source = out / f'{prefix}-source.zip'
subprocess.run(['git', 'archive', '--format=zip', f'--prefix={prefix}/', '-o', str(source), tag], cwd=root, check=True)
dist = root / 'app/dist'
if not (dist / 'index.html').exists():
    raise SystemExit('Run npm run build in app first.')
web = out / f'{prefix}-web.zip'
with zipfile.ZipFile(web, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(dist.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(dist).as_posix())
    archive.write(root / f'docs/releases/{tag}.md', 'RELEASE-NOTES.md')
    archive.write(root / 'app/src/components/ui/LICENSE', 'licenses/shadcn-LICENSE.txt')
    for path in sorted((root / 'app/node_modules').rglob('*')):
        if path.is_file() and path.name.lower() in ('license', 'license.md', 'license.txt', 'copying'):
            archive.write(path, 'licenses/dependencies/' + path.relative_to(root / 'app/node_modules').as_posix())
    archive.writestr('BUILD.json', json.dumps({'version': version, 'commit': head.decode(), 'mode': 'local-only'}, indent=2))
checksums = []
for path in (source, web):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise SystemExit(f'Invalid ZIP: {path}')
        if any('/node_modules/' in name or Path(name).name.startswith('.env') for name in archive.namelist()):
            raise SystemExit(f'Unexpected dependency or environment file in {path}')
    checksums.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}')
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
print(out)
print('\n'.join(checksums))
