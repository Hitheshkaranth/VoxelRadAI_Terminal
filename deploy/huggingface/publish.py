"""Mirror the app into private Skanda V1, then deploy the public VoxelRad Space."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

from huggingface_hub import HfApi, get_token, hf_hub_download, CommitOperationAdd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/huggingface"
REPO = "hitheshkaranth/Skanda-V1"
SPACE_REPO = "hitheshkaranth/VoxelRad"
api = HfApi()

OUT.mkdir(parents=True, exist_ok=True)
STAGE = Path(tempfile.mkdtemp(prefix="source-", dir=OUT))
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
extra = [str(p.relative_to(ROOT)) for p in (ROOT / "deploy/huggingface").rglob("*")
         if p.is_file() and "__pycache__" not in p.parts]
extra.append("docs/huggingface.md")
for name in sorted(set(tracked + extra)):
    if not name:
        continue
    source = ROOT / name
    if source.is_file():
        target = STAGE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

if not (ROOT / "app/dist/index.html").is_file():
    raise SystemExit("Build app/dist before publishing")
shutil.copytree(ROOT / "app/dist", STAGE / "app/dist", dirs_exist_ok=True)
model_info = api.model_info(REPO)
revision = model_info.sha
provenance = {"application_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
              "model_revision": revision, "hardware": "zero-a10g (xlarge 96 GB per call)",
              "local_changes_included": True}
(STAGE / "deploy/huggingface/source.json").write_text(json.dumps(provenance, indent=2) + "\n")

model_commit = api.upload_folder(repo_id=REPO, folder_path=STAGE, path_in_repo="application",
                                commit_message="Add complete RadGenis application and ZeroGPU deployment",
                                parent_commit=revision)
print("Model application:", model_commit.commit_url, flush=True)

# Keep the model card intact and add a discoverable application link.
card = Path(hf_hub_download(REPO, "README.md")).read_text()
if "## Application source and Space" not in card:
    card += ("\n## Application source and Space\n\n"
             "The complete RadGenis application is in [`application/`](application/). "
             "Open the public [VoxelRad Space](https://huggingface.co/spaces/" + SPACE_REPO + ") "
             "for the workspace and queued ZeroGPU reads. See "
             "[`application/docs/huggingface.md`](application/docs/huggingface.md) for setup and limitations.\n")
    api.create_commit(repo_id=REPO, operations=[CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=card.encode())],
                      commit_message="Link bundled application and Skanda V1 Space", parent_commit=model_commit.oid)

api.create_repo(SPACE_REPO, repo_type="space", space_sdk="gradio", private=False, exist_ok=True)
credentials_file = OUT / "admin-credentials.json"
if credentials_file.exists():
    credentials = json.loads(credentials_file.read_text())
else:
    credentials = {"email": "admin@skanda.local", "password": secrets.token_urlsafe(32),
                   "workspace": "https://hitheshkaranth-voxelrad.hf.space/workspace"}
    fd = os.open(credentials_file, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(credentials, handle, indent=2)
        handle.write("\n")
for key, value in {"HF_TOKEN": get_token(), "BOOTSTRAP_ADMIN_EMAIL": credentials["email"],
                   "BOOTSTRAP_ADMIN_PASSWORD": credentials["password"]}.items():
    if not value:
        raise SystemExit(f"Missing {key}")
    api.add_space_secret(SPACE_REPO, key=key, value=value)
for key, value in {"MODEL_REPO": REPO, "MODEL_REVISION": revision}.items():
    api.add_space_variable(SPACE_REPO, key=key, value=value)

shutil.copy2(STAGE / "README.md", STAGE / "APPLICATION_README.md")
shutil.copy2(STAGE / "deploy/huggingface/SPACE_README.md", STAGE / "README.md")
for name in ("requirements.txt", "packages.txt"):
    shutil.copy2(STAGE / "deploy/huggingface" / name, STAGE / name)
space_commit = api.upload_folder(repo_id=SPACE_REPO, repo_type="space", folder_path=STAGE,
                                commit_message="Deploy full Skanda V1 application with ZeroGPU xlarge inference")
print("Space source:", space_commit.commit_url, flush=True)
try:
    runtime = api.request_space_hardware(SPACE_REPO, hardware="zero-a10g")
    print("ZeroGPU hardware request:", runtime.raw, flush=True)
except Exception as error:
    print("ZeroGPU hardware request failed:", str(error), flush=True)
    raise
print("Administrator credentials:", credentials_file, flush=True)
