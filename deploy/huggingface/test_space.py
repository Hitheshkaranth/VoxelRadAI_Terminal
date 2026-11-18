"""Exercise the real facade routes without loading model weights or starting services."""
import ast
import asyncio
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
import uuid

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.testclient import TestClient


class FacadeTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        tree = ast.parse(Path(__file__).with_name("space_app.py").read_text())
        names = {"authenticate_inference", "models", "completion", "api_proxy"}
        routes = ast.Module(body=[node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names], type_ignores=[])
        namespace = {"app": self.app, "httpx": httpx, "Request": Request, "JSONResponse": JSONResponse,
                     "Response": Response, "json": json, "os": os, "uuid": uuid, "MODEL_ID": "skanda-v1", "APP_PORT": 7861,
                     "asyncio": asyncio, "READ_TIMEOUT_SECONDS": 1, "demo": SimpleNamespace(_queue=SimpleNamespace(clean_events=AsyncMock()))}
        self.namespace = namespace
        exec(compile(routes, "space_app.py", "exec"), namespace)
        self.mode = "complete"
        self.queued = []
        self.user = {"role": "clinician", "email": "visitor@example.com"}
        self.original_client = httpx.AsyncClient
        self.client = TestClient(self.app)

    def upstream(self, request):
        if request.url.path == "/api/session":
            return httpx.Response(200, json={"user": self.user if "skanda_session=test" in request.headers.get("cookie", "") else None})
        if request.url.path == "/api/login":
            self.assertEqual(request.headers["origin"], "https://test.space")
            return httpx.Response(200, json={"user": {"role": "admin"}}, headers={"set-cookie": "skanda_session=test; Secure; HttpOnly"})
        if request.method == "POST" and request.url.path.endswith("/call/read"):
            self.queued.append(request)
            if request.url.scheme == "https":
                self.assertEqual(request.headers["authorization"], "Bearer owner-test-token")
                self.assertNotIn("x-ip-token", request.headers)
                self.assertNotIn("origin", request.headers)
            else:
                self.assertEqual(request.headers["x-ip-token"], "signed-visitor")
                self.assertNotEqual(request.headers.get("authorization"), "Bearer owner-test-token")
            if self.mode == "queue-unavailable":
                return httpx.Response(503)
            return httpx.Response(200, json={"event_id": "event-1"})
        if request.method == "GET" and request.url.path.endswith("/event-1"):
            self.assertEqual(request.url.host, "127.0.0.1")
            self.assertNotIn("authorization", request.headers)
            if self.mode == "stall":
                class Heartbeats(httpx.AsyncByteStream):
                    async def __aiter__(self):
                        while True:
                            yield b'event: heartbeat\ndata: null\n\n'
                            await asyncio.sleep(.005)
                return httpx.Response(200, stream=Heartbeats())
            report = {"text": json.dumps({"findings": [], "impression": "Synthetic test"}), "finish": "stop"}
            body = "event: heartbeat\ndata: null\n\n"
            if self.mode == "complete":
                body += "event: complete\ndata: " + json.dumps([report]) + "\n\n"
            elif self.mode == "quota":
                body += 'event: error\ndata: "GPU quota exhausted"\n\n'
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        raise AssertionError(str(request.url))

    def transport_client(self, *args, **kwargs):
        return self.original_client(transport=httpx.MockTransport(self.upstream), **kwargs)

    def read(self):
        with patch.object(httpx, "AsyncClient", self.transport_client):
            return self.client.post("/lmstudio/v1/chat/completions", json={"model": "skanda-v1", "messages": [], "stream": True},
                                    headers={"cookie": "skanda_session=test", "x-ip-token": "signed-visitor"})

    def test_authentication_before_queue(self):
        with patch.object(httpx, "AsyncClient", self.transport_client):
            result = self.client.post("/lmstudio/v1/chat/completions", json={})
            self.assertEqual(result.status_code, 401)
            self.assertEqual(self.queued, [])

    def test_queued_read_keeps_visitor_and_openai_contract(self):
        result = self.read()
        self.assertEqual(result.status_code, 200)
        self.assertIn(": queued", result.text)
        self.assertIn("data: [DONE]", result.text)
        event = next(json.loads(line[6:]) for line in result.text.splitlines() if line.startswith("data: {") )
        self.assertEqual(event["choices"][0]["finish_reason"], "stop")
        self.assertEqual(json.loads(event["choices"][0]["delta"]["content"])["findings"], [])
        self.assertEqual(json.loads(self.queued[0].content)["data"][0]["model"], "skanda-v1")

    def test_quota_error_reaches_app(self):
        self.mode = "quota"
        self.assertIn("GPU quota exhausted", self.read().text)

    def test_only_owner_admin_uses_pro_gateway(self):
        with patch.dict(os.environ, {"BOOTSTRAP_ADMIN_EMAIL": "owner@example.com", "HF_TOKEN": "owner-test-token"}):
            self.user = {"role": "admin", "email": "owner@example.com"}
            result = self.read()
            self.assertEqual(result.headers["x-voxelrad-quota-identity"], "owner")
            self.assertNotIn("owner-test-token", result.text)
            self.assertEqual(self.queued[-1].url.host, "hitheshkaranth-voxelrad.hf.space")
            for user in ({"role": "admin", "email": "other@example.com"},
                         {"role": "clinician", "email": "owner@example.com"}):
                self.user = user
                result = self.read()
                self.assertEqual(result.headers["x-voxelrad-quota-identity"], "visitor")
                self.assertEqual(self.queued[-1].url.host, "127.0.0.1")

    def test_disconnect_is_an_error(self):
        self.mode = "disconnect"
        self.assertIn("disconnected before completion", self.read().text)
        self.namespace["demo"]._queue.clean_events.assert_awaited_once_with(event_id="event-1")

    def test_heartbeats_cannot_extend_total_deadline(self):
        self.mode = "stall"
        self.namespace["READ_TIMEOUT_SECONDS"] = .03
        result = self.read()
        self.assertIn("ZeroGPU read timed out", result.text)
        self.assertIn("data: [DONE]", result.text)
        self.namespace["demo"]._queue.clean_events.assert_awaited_once_with(event_id="event-1")

    def test_unavailable_queue(self):
        self.mode = "queue-unavailable"
        self.assertEqual(self.read().status_code, 503)

    def test_login_preserves_secure_cookie(self):
        with patch.object(httpx, "AsyncClient", self.transport_client):
            result = self.client.post("/api/login", json={"email": "test@example.com"}, headers={"origin": "https://test.space"})
            self.assertEqual(result.status_code, 200)
            self.assertIn("Secure; HttpOnly", result.headers["set-cookie"])


if __name__ == "__main__":
    unittest.main()


class TrainingSyncTests(unittest.TestCase):
    """The dataset sync uploads images, audio and records, then marks them synced only after upload."""

    def setUp(self):
        import base64, secrets, tempfile
        tree = ast.parse(Path(__file__).with_name("space_app.py").read_text())
        keep = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == "sync_training_once")
                or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "EXTENSIONS" for t in n.targets))]
        self.ns = {"httpx": httpx, "os": os, "json": json, "base64": base64, "secrets": secrets, "tempfile": tempfile,
                   "Path": Path, "TRAINING_SYNC_TOKEN": "tok"}
        exec(compile(ast.Module(body=keep, type_ignores=[]), "space_app.py", "exec"), self.ns)

    def test_uploads_then_marks_synced(self):
        import base64
        batches = [{"cases": [{"id": "7", "kind": "analysis", "study_ref": "s", "image_ref": "i", "image_sha256": "a" * 64, "modality": "X-ray",
                               "model": "skanda-v1", "payload": {"findings": []}, "created_at": "2026-11-19T10:00:00.000Z", "mime": "image/jpeg",
                               "image_b64": base64.b64encode(b"jpegbytes").decode()}],
                    "dictation": [{"id": "3", "kind": "undone", "user_ref": "u", "language": "en-IN", "transcript": "plural effusion", "corrected": "",
                                   "error": "", "audio_mime": "audio/webm", "audio_b64": base64.b64encode(b"webm").decode(),
                                   "created_at": "2026-11-19T10:00:01.000Z"}]},
                   {"cases": [], "dictation": []}]
        uploaded, marked = [], []

        class Api:
            def upload_folder(self, repo_id, repo_type, folder_path, commit_message):
                uploaded.append(sorted(str(p.relative_to(folder_path)) for p in Path(folder_path).rglob("*") if p.is_file()))
                self_test.assertEqual((repo_id, repo_type), ("me/VoxelRad-training", "dataset"))
        self_test = self
        get = lambda url, headers, timeout: SimpleNamespace(json=lambda: batches.pop(0))
        def post(url, headers, timeout, json):
            self.assertEqual(headers["x-sync-token"], "tok"); self.assertTrue(uploaded, "marked before upload")
            marked.append(json); return SimpleNamespace(raise_for_status=lambda: None)
        with patch.object(httpx, "get", get), patch.object(httpx, "post", post):
            total = self.ns["sync_training_once"](Api(), "me/VoxelRad-training")
        self.assertEqual(total, 2)
        files = uploaded[0]
        self.assertIn("images/" + "a" * 64 + ".jpg", files)
        self.assertTrue(any(f.startswith("cases/2026-11-19/") and f.endswith(".json") for f in files))
        self.assertTrue(any(f.startswith("dictation/2026-11-19/") and f.endswith(".webm") for f in files))
        self.assertEqual(marked, [{"cases": ["7"], "dictation": ["3"]}])

    def test_failed_upload_leaves_records_unsynced(self):
        batches = [{"cases": [{"id": "1", "kind": "signed", "study_ref": "s", "image_ref": None, "image_sha256": None, "modality": "", "model": "",
                               "payload": {}, "created_at": "2026-11-19T10:00:00.000Z", "mime": None, "image_b64": None}], "dictation": []}]
        class Api:
            def upload_folder(self, **kwargs): raise RuntimeError("hub down")
        get = lambda url, headers, timeout: SimpleNamespace(json=lambda: batches.pop(0))
        post = lambda *a, **k: self.fail("must not mark synced after a failed upload")
        with patch.object(httpx, "get", get), patch.object(httpx, "post", post):
            with self.assertRaises(RuntimeError):
                self.ns["sync_training_once"](Api(), "me/VoxelRad-training")
