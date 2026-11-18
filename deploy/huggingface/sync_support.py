"""Update deployment helpers and documentation without reuploading the app bundle."""
from pathlib import Path
import argparse
import subprocess
from huggingface_hub import HfApi, CommitOperationAdd

parser = argparse.ArgumentParser()
parser.add_argument("--model-only", action="store_true")
parser.add_argument("--frontend", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
repo = "hitheshkaranth/Skanda-V1"
files = [p for p in (root / "deploy/huggingface").iterdir() if p.is_file()]
files += [root / "docs/huggingface.md"]
files += [root / name for name in ("server/src/index.mjs", "server/package.json", "server/package-lock.json", "package.json", "package-lock.json", "config.example")]
if args.frontend:
    if not (root / "app/dist/index.html").is_file():
        raise SystemExit("Build the hosted frontend before syncing")
    changed = subprocess.check_output(["git", "ls-files", "-m", "--others", "--exclude-standard", "-z", "--", "app"], cwd=root).decode().split("\0")
    files += [root / name for name in changed if name and (root / name).is_file()]
    files += [p for p in (root / "app/dist").rglob("*") if p.is_file()]
    files.append(root / "PRODUCT.md")
files = list(dict.fromkeys(files))
validation = root / "docs/validation/2026-11-16-huggingface-zero-gpu.md"
if validation.exists():
    files.append(validation)
api = HfApi()
for kind in (("model",) if args.model_only else ("model", "space")):
    target_repo = repo if kind == "model" else "hitheshkaranth/VoxelRad"
    prefix = "application/" if kind == "model" else ""
    operations = [CommitOperationAdd(path_in_repo=prefix + p.relative_to(root).as_posix(), path_or_fileobj=str(p)) for p in files]
    operations.append(CommitOperationAdd(path_in_repo="application/README.md" if kind == "model" else "APPLICATION_README.md",
                                         path_or_fileobj=str(root / "README.md")))
    if kind == "space":
        for name in ("requirements.txt", "packages.txt"):
            operations.append(CommitOperationAdd(path_in_repo=name, path_or_fileobj=str(root / "deploy/huggingface" / name)))
        operations.append(CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=str(root / "deploy/huggingface/SPACE_README.md")))
    result = api.create_commit(repo_id=target_repo, repo_type=kind, operations=operations,
                               commit_message="Verify ZeroGPU facade and update deployment helpers")
    print(kind, result.commit_url, flush=True)
