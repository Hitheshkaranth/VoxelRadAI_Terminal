"""GPU server contract tests with a stand-in reader: no weights, GPU or network needed."""
import json
import threading
import time
import unittest

from fastapi.testclient import TestClient

from serve import create_app

SECRET = "s" * 40
AUTH = {"X-VoxelRad-Bridge": SECRET}


def events(text):
    return [line for line in text.split("\n") if line]


class GpuServerTests(unittest.TestCase):
    def client(self, read, **options):
        return TestClient(create_app(read, bridge_secret=SECRET, heartbeat=0.05, **options))

    def test_requires_bridge_secret(self):
        client = self.client(lambda p: ("{}", "stop"))
        self.assertEqual(client.get("/v1/models").status_code, 401)
        self.assertEqual(client.get("/v1/models", headers={"X-VoxelRad-Bridge": "x" * 40}).status_code, 401)
        self.assertEqual(client.get("/healthz").status_code, 200)
        self.assertEqual(client.get("/v1/models", headers=AUTH).json()["data"][0]["id"], "skanda-v1")
        with self.assertRaises(ValueError):
            create_app(lambda p: None, bridge_secret="short")

    def test_read_streams_one_chunk_then_done(self):
        client = self.client(lambda p: (json.dumps({"impression": "Normal."}), "stop"))
        response = client.post("/v1/chat/completions", headers=AUTH, json={"model": "skanda-v1", "messages": []})
        self.assertEqual(response.status_code, 200)
        lines = events(response.text)
        self.assertEqual(lines[-1], "data: [DONE]")
        chunk = json.loads(lines[-2][6:])
        self.assertEqual(chunk["choices"][0]["delta"]["content"], '{"impression": "Normal."}')
        self.assertEqual(chunk["choices"][0]["finish_reason"], "stop")

    def test_heartbeats_while_running_and_errors_in_stream(self):
        client = self.client(lambda p: (time.sleep(0.2), ("x", "stop"))[1])
        self.assertIn(": queued", client.post("/v1/chat/completions", headers=AUTH, json={}).text)

        def boom(_):
            raise RuntimeError("cuda")
        text = self.client(boom).post("/v1/chat/completions", headers=AUTH, json={}).text
        self.assertIn("failed on the GPU server", text)
        self.assertTrue(text.rstrip().endswith("data: [DONE]"))

    def test_timeout_message_is_recognised_by_the_proxy(self):
        text = self.client(lambda p: (time.sleep(0.5), ("x", "stop"))[1], read_timeout=0.1).post("/v1/chat/completions", headers=AUTH, json={}).text
        self.assertIn("timed out", text)  # modelProxy.streamFailure maps "timed out" to 504

    def test_full_server_answers_429_before_streaming(self):
        gate = threading.Event()
        client = self.client(lambda p: (gate.wait(5), ("x", "stop"))[1], max_queue=0)
        results = []
        first = threading.Thread(target=lambda: results.append(client.post("/v1/chat/completions", headers=AUTH, json={})))
        first.start()
        deadline = time.time() + 5
        while client.get("/status", headers=AUTH).json()["running"] == 0 and time.time() < deadline:
            time.sleep(0.01)
        busy = client.post("/v1/chat/completions", headers=AUTH, json={})
        self.assertEqual(busy.status_code, 429)
        self.assertIn("busy", busy.json()["error"])  # modelProxy.upstreamError maps 429 to upstream_busy
        gate.set()
        first.join(5)
        self.assertEqual(results[0].status_code, 200)
        status = client.get("/status", headers=AUTH).json()
        self.assertEqual((status["waiting"], status["running"], status["completed"], status["rejected"]), (0, 0, 1, 1))

    def test_rejects_other_models_and_bad_bodies(self):
        client = self.client(lambda p: ("x", "stop"))
        self.assertEqual(client.post("/v1/chat/completions", headers=AUTH, json={"model": "gpt"}).status_code, 404)
        self.assertEqual(client.post("/v1/chat/completions", headers={**AUTH, "Content-Type": "application/json"}, content=b"[1]").status_code, 400)


if __name__ == "__main__":
    unittest.main()
