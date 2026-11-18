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
