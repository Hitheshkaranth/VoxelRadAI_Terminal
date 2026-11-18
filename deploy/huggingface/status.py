"""Inspect deployment; optionally exercise sign-in and one queued chest read."""
import argparse
import base64
import json
import os
from pathlib import Path

import httpx
from huggingface_hub import HfApi, get_token

parser = argparse.ArgumentParser()
parser.add_argument("--logs", choices=["build", "run"])
parser.add_argument("--probe", action="store_true")
parser.add_argument("--read", action="store_true")
parser.add_argument("--browser-quota", action="store_true", help="Test app cookie alone, without a browser HF bearer token")
parser.add_argument("--queue", action="store_true", help="Inspect administrator-only queue diagnostics")
parser.add_argument("--browser-state", action="store_true")
parser.add_argument("--restore-workspace", action="store_true")
args = parser.parse_args()
repo = "hitheshkaranth/VoxelRad"
api = HfApi()
info = api.space_info(repo)
print("Space", info.id, "private", info.private, "SHA", info.sha, flush=True)
print("Runtime", json.dumps(api.get_space_runtime(repo).raw), flush=True)
if args.logs:
    for line in api.fetch_space_logs(repo, build=args.logs == "build", follow=False):
        if line.lstrip("\r").startswith(("Downloading bytes:", "Reconstructing", "Fetching ", "Loading weights:")):
            continue
        print(line, flush=True)
if args.probe or args.read or args.browser_state or args.queue:
    root = Path(__file__).resolve().parents[2]
    credentials = json.loads((root / "output/huggingface/admin-credentials.json").read_text())
    origin = "https://hitheshkaranth-voxelrad.hf.space"
    with httpx.Client(base_url=origin, headers={"Authorization": "Bearer " + get_token(), "Origin": origin},
                      timeout=600, follow_redirects=True) as client:
        for path in ("/", "/workspace", "/healthz", "/api/session", "/lmstudio/v1/models"):
            result = client.get(path)
            print("GET", path, result.status_code, result.text[:150] if "html" not in result.headers.get("content-type", "") else "HTML", flush=True)
        result = client.post("/api/login", json={"email": credentials["email"], "password": credentials["password"]})
        print("Login", result.status_code, "session cookie", "skanda_session" in client.cookies, flush=True)
        result.raise_for_status()
        if args.browser_state:
            state = {"cookies": [{"name": cookie.name, "value": cookie.value,
                      "domain": "hitheshkaranth-voxelrad.hf.space", "path": cookie.path,
                      "expires": cookie.expires or -1, "httpOnly": True, "secure": True,
                      "sameSite": "Strict"} for cookie in client.cookies.jar if cookie.name == "skanda_session"], "origins": []}
            if args.restore_workspace:
                # Restore only this administrator's backed-up workspace after the
                # ephemeral database restart creates a new bootstrap user UUID.
                user = result.json()["user"]
                if user["email"] != credentials["email"]:
                    raise RuntimeError("Refusing to restore a workspace to another account")
                backup = json.loads((root / "output/huggingface/guide-backup.json").read_text())
                origins = [item for item in backup["origins"] if item["origin"] == origin]
                for item in origins:
                    databases = item.get("indexedDB", [])
                    if len(databases) > 1:
                        raise RuntimeError("Workspace backup contains multiple accounts; restore explicitly")
                    for database in databases:
                        if not database["name"].startswith("skanda-user-"):
                            raise RuntimeError("Unexpected workspace database")
                        database["name"] = "skanda-user-" + user["id"]
                state["origins"] = origins
            destination = root / "output/huggingface/browser-state.json"
            fd = os.open(destination, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump(state, handle)
            print("Browser state saved to ignored output directory", flush=True)
        result = client.get("/lmstudio/v1/models")
        print("Authenticated models", result.status_code, result.text[:300], flush=True)
        result.raise_for_status()
        if args.queue:
            result = client.get('/lmstudio/status')
            print('Inference queue', result.status_code, result.text[:1500], flush=True)
            result.raise_for_status()
        if args.read:
            if args.browser_quota:
                del client.headers["Authorization"]
            image = root / "app/public/landing/cxr-69598.webp"
            encoded = "data:image/webp;base64," + base64.b64encode(image.read_bytes()).decode()
            payload = {"model": "skanda-v1", "stream": True, "max_tokens": 1024, "temperature": 0,
                       "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": encoded}}]}]}
            with client.stream("POST", "/lmstudio/v1/chat/completions", json=payload) as result:
                print("Read HTTP", result.status_code, flush=True)
                print("Quota identity", result.headers.get("x-voxelrad-quota-identity", "unreported"), flush=True)
                result.raise_for_status()
                completed = False
                text = ""
                for line in result.iter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        event = json.loads(line[6:])
                        if "error" in event:
                            raise RuntimeError(str(event["error"]))
                        text += event["choices"][0]["delta"].get("content", "")
                    elif line == "data: [DONE]":
                        completed = True
                if not completed or not text:
                    raise RuntimeError("Read did not complete")
                report = json.loads(text)
                print("Live read passed:", len(report.get("findings", [])), "findings; modality", report.get("modality"), flush=True)
