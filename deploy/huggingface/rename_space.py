"""Rename only the public Space; preserve the private Skanda V1 model."""
import json
from pathlib import Path

from huggingface_hub import HfApi, CommitOperationAdd, hf_hub_download
from huggingface_hub.errors import RepositoryNotFoundError

api = HfApi()
old = "hitheshkaranth/Skanda-V1"
new = "hitheshkaranth/VoxelRad"
assert api.model_info(old).private, "Skanda V1 model must remain private"
try:
    api.space_info(new)
except RepositoryNotFoundError:
    api.move_repo(from_id=old, to_id=new, repo_type="space")
else:
    # A moved Space resolves the old name through a redirect. Refuse to replace
    # an unrelated repository if VoxelRad already exists.
    assert api.space_info(old).id == api.space_info(new).id, "VoxelRad already exists separately"
assert not api.space_info(new).private, "The VoxelRad application should remain public"
assert api.model_info(old).private

card = Path(hf_hub_download(old, "README.md")).read_text()
updated = card.replace("https://huggingface.co/spaces/" + old, "https://huggingface.co/spaces/" + new)
updated = updated.replace("Run the private [Skanda V1 Space]", "Open the public [VoxelRad Space]")
if updated != card:
    api.create_commit(repo_id=old, operations=[CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=updated.encode())],
                      commit_message="Link public VoxelRad application; keep Skanda V1 model private")
credentials_file = Path(__file__).resolve().parents[2] / "output/huggingface/admin-credentials.json"
if credentials_file.exists():
    credentials = json.loads(credentials_file.read_text())
    credentials["workspace"] = "https://hitheshkaranth-voxelrad.hf.space/workspace"
    credentials_file.write_text(json.dumps(credentials, indent=2) + "\n")
print("Public application:", api.space_info(new).id)
print("Private model:", api.model_info(old).id)
