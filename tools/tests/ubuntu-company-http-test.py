#!/usr/bin/env python3
"""Actual HTTP + disposable synthetic CLI helpers; never opens a database."""
import concurrent.futures
from contextlib import closing
import hashlib
import hmac
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location("http_bridge", Path(__file__).resolve().parents[1] / "ubuntu-company-http.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

FIXTURE_HELPER = r'''
import argparse,json,pathlib,sys,time,uuid
p=argparse.ArgumentParser();p.add_argument('--config',required=True);args=p.parse_args()
cfg=json.loads(pathlib.Path(args.config).read_text())
request=json.loads(sys.stdin.buffer.read())
# One unique marker per process avoids a concurrent append race on Windows.
marker=pathlib.Path(__file__).with_name('call-'+uuid.uuid4().hex+'.log')
marker.write_text(cfg['fixtureRoute'])
mode=request.get('fixtureMode')
if mode=='failure':
 sys.stderr.write('SYNTHETIC_PRIVATE_STDERR_DO_NOT_LOG');sys.exit(9)
if mode=='invalid':print('not-json');sys.exit(0)
if mode=='protocol':print(json.dumps({'protocol':'wrong','ok':True}));sys.exit(0)
if mode=='large':print('x'*4096);sys.exit(0)
if mode=='slow':time.sleep(request.get('fixtureDelay',0.8))
print(json.dumps({'protocol':'vg-ubuntu-company/1','ok':True,'healthy':True,'fixtureRoute':cfg['fixtureRoute'],'fixtureOp':request['op'],'fixtureNote':request.get('fixtureNote')}))
'''


class HttpBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="vg-synthetic-http-")
        self.directory = Path(self.temp.name)
        self.source = self.directory / "http-config.json"
        self.fixture_config = {"version": 1, "keyId": "synthetic-key-1", "secret": "ab" * 32,
                               "site": "cd" * 16, "listenPort": 19187}
        for route, name in (("company", "company_store.py"), ("saha", "saha_store.py")):
            helper = self.directory / name
            helper.write_text(FIXTURE_HELPER, encoding="utf-8")
            self.fixture_config[route + "Helper"] = str(helper)
            (self.directory / ("config.json" if route == "company" else "saha-config.json")).write_text(json.dumps({"fixtureRoute": route}))
        self.source.write_text(json.dumps(self.fixture_config))
        os.chmod(self.source, 0o600)
        self.config = bridge.load_config(self.source)
        # Port 0 is a fixture-only ephemeral bind; private production configs
        # are validated to a concrete unprivileged port.
        self.config["port"] = 0
        self.start()

    def start(self):
        self.server = bridge.BridgeServer(self.config)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def payload(self, route="company", op="snapshot", **fields):
        return {"route": route, "request": {"op": op, "site": self.fixture_config["site"],
                "actor": {"id": "11111111-1111-4111-8111-111111111111", "role": "admin"}, **fields}}

    def signed(self, body, stamp=None, nonce=None):
        stamp = str(int(time.time()) if stamp is None else stamp)
        nonce = secrets.token_hex(16) if nonce is None else nonce
        # Independent client-side implementation, not bridge.canonical().
        message = "POST\n/voltguard-company/v1\n" + self.fixture_config["keyId"] + "\n" + stamp + "\n" + nonce + "\n" + hashlib.sha256(body).hexdigest()
        signature = hmac.new(bytes.fromhex(self.fixture_config["secret"]), message.encode("ascii"), hashlib.sha256).hexdigest()
        return {"X-VG-Bridge-Key": self.fixture_config["keyId"], "X-VG-Bridge-Time": stamp,
                "X-VG-Bridge-Nonce": nonce, "X-VG-Bridge-Signature": signature,
                "Content-Type": "application/json"}

    def request(self, payload=None, body=None, headers=None, method="POST", path=bridge.ENDPOINT):
        body = json.dumps(self.payload() if payload is None else payload, ensure_ascii=False, separators=(",", ":")).encode() if body is None else body
        headers = self.signed(body) if headers is None else headers
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=8)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            result = response.read()
            return response.status, json.loads(result) if result else None, dict(response.getheaders())
        finally:
            connection.close()

    def count_nonces(self):
        with closing(sqlite3.connect(self.config["nonceFile"])) as db:
            return db.execute("SELECT count(*) FROM nonces").fetchone()[0]

    def calls(self):
        return sorted(text for path in self.directory.glob("call-*.log") if (text := path.read_text()))

    def assert_error(self, expected_status, expected_code, **kwargs):
        status, result, headers = self.request(**kwargs)
        self.assertEqual(status, expected_status)
        self.assertEqual(result["protocol"], bridge.PROTOCOL)
        self.assertIs(result["ok"], False)
        self.assertEqual(result["code"], expected_code)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_loopback_only_and_real_both_route_helper_processes(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        for route in ("company", "saha"):
            for op in ("health", "snapshot", "commit"):
                status, result, headers = self.request(self.payload(route, op, fixtureNote="Türkçe elektrik ⚡"))
                self.assertEqual(status, 200)
                self.assertEqual(result["fixtureRoute"], route)
                self.assertEqual(result["fixtureOp"], op)
                self.assertEqual(result["fixtureNote"], "Türkçe elektrik ⚡")
                self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.calls(), ["company"] * 3 + ["saha"] * 3)

    def test_missing_bad_key_signature_skew_and_malformed_nonce_do_not_touch_helpers_or_replay_store(self):
        body = json.dumps(self.payload()).encode()
        variants = [{}]
        for field, value in (("X-VG-Bridge-Key", "wrong-key"), ("X-VG-Bridge-Signature", "0" * 64),
                             ("X-VG-Bridge-Nonce", "../nonce"), ("X-VG-Bridge-Time", str(int(time.time()) - 120)),
                             ("X-VG-Bridge-Time", str(int(time.time()) + 120))):
            headers = self.signed(body)
            headers[field] = value
            variants.append(headers)
        for headers in variants:
            with self.subTest(fields=list(headers)):
                self.assert_error(401, "bridge_http_auth", body=body, headers=headers)
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.count_nonces(), 0)

    def test_signature_binds_original_bytes_not_reserialized_json(self):
        body = json.dumps(self.payload()).encode()
        headers = self.signed(body)
        self.assert_error(401, "bridge_http_auth", body=body + b" ", headers=headers)
        self.assertEqual(self.count_nonces(), 0)

    def test_replay_rejected_concurrently_and_across_server_restart(self):
        body = json.dumps(self.payload()).encode()
        headers = self.signed(body)
        self.assertEqual(self.request(body=body, headers=headers)[0], 200)
        self.assert_error(403, "bridge_http_replay", body=body, headers=headers)
        self.stop()
        self.start()
        self.assert_error(403, "bridge_http_replay", body=body, headers=headers)
        self.assertEqual(self.calls(), ["company"])
        self.assertEqual(self.count_nonces(), 1)
        if os.name == "posix":
            self.assertEqual(Path(self.config["nonceFile"]).stat().st_mode & 0o077, 0)

    def test_atomic_nonce_race_allows_only_one_helper(self):
        body = json.dumps(self.payload()).encode()
        headers = self.signed(body)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.request(body=body, headers=headers)[0], range(4)))
        self.assertEqual(sorted(results), [200, 403, 403, 403])
        self.assertEqual(self.calls(), ["company"])

    def test_fixed_route_site_and_operation_allowlist_before_helper_or_nonce(self):
        for route in ("https://example.invalid", "../company_store.py", "", ["company"]):
            self.assert_error(403, "bridge_http_route", payload=self.payload(route))
        for site in ("0" * 32, "ş" * 32, "", None):
            payload = self.payload()
            payload["request"]["site"] = site
            self.assert_error(403, "bridge_http_site", payload=payload)
        for op in ("install", "shell", [], None):
            self.assert_error(403, "bridge_http_operation", payload=self.payload(op=op))
        payload = self.payload()
        payload["helper"] = "/tmp/other.py"
        self.assert_error(400, "bridge_http_envelope", payload=payload)
        self.assertEqual(self.count_nonces(), 0)
        self.assertEqual(self.calls(), [])

    def test_legacy_file_operation_is_only_forwarded_to_saha_fixed_helper(self):
        self.assert_error(403, "bridge_http_operation", payload=self.payload("company", "file"))
        self.assertEqual(self.calls(), [])
        status, result, _ = self.request(self.payload("saha", "file"))
        self.assertEqual(status, 200)
        self.assertEqual(result["fixtureRoute"], "saha")
        self.assertEqual(result["fixtureOp"], "file")
        self.assertEqual(self.calls(), ["saha"])

    def test_methods_exact_path_and_json_format_rejected(self):
        for method in ("GET", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"):
            self.assert_error(405, "bridge_http_method", method=method)
        for path in ("/voltguard-company/v1/", "/voltguard-company/v1?x=1", "/health"):
            self.assert_error(404, "bridge_http_path", path=path)
        for body in (b"not JSON", b'{"route":"company","route":"saha","request":{}}', b'{"route":"company","request":NaN}'):
            self.assert_error(400, "bridge_http_body", body=body)
        body = json.dumps(self.payload()).encode()
        headers = self.signed(body)
        headers["Content-Type"] = "text/plain"
        self.assert_error(415, "bridge_http_content_type", body=body, headers=headers)
        self.assertEqual(self.calls(), [])

    def test_body_limit_is_checked_before_reading_or_helper(self):
        body = b"{}"
        headers = self.signed(body)
        headers["Content-Length"] = str(bridge.MAX_BODY + 1)
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.putrequest("POST", bridge.ENDPOINT)
            for key, value in headers.items():
                connection.putheader(key, value)
            connection.endheaders()
            # No body is uploaded: a too-large advertised length must be
            # rejected immediately rather than waiting for the attacker.
            response = connection.getresponse()
            self.assertEqual(response.status, 413)
            self.assertEqual(json.loads(response.read())["code"], "bridge_http_body_size")
        finally:
            connection.close()
        self.assertEqual(self.count_nonces(), 0)
        self.assertEqual(self.calls(), [])

    def test_helper_failure_invalid_protocol_size_timeout_return_private_json_errors(self):
        for mode, code in (("failure", "bridge_http_helper"), ("invalid", "bridge_http_helper_response"), ("protocol", "bridge_http_helper_response")):
            self.assert_error(503, code, payload=self.payload(fixtureMode=mode))
        original = bridge.MAX_RESPONSE
        try:
            bridge.MAX_RESPONSE = 256
            self.assert_error(503, "bridge_http_response_size", payload=self.payload(fixtureMode="large"))
        finally:
            bridge.MAX_RESPONSE = original
        original = bridge.HELPER_TIMEOUT
        try:
            bridge.HELPER_TIMEOUT = 0.1
            self.assert_error(503, "bridge_http_timeout", payload=self.payload(fixtureMode="slow", fixtureDelay=2))
        finally:
            bridge.HELPER_TIMEOUT = original
        self.assertEqual(self.request()[0], 200, "Failed helpers must release their concurrency slot")

    def test_at_most_four_helpers_and_busy_request_can_retry_with_same_unused_nonce(self):
        body = json.dumps(self.payload(fixtureMode="slow", fixtureDelay=1)).encode()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(self.request, body=body) for _ in range(4)]
            deadline = time.monotonic() + 5
            while len(self.calls()) < 4 and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(len(self.calls()), 4)
            retry_body = json.dumps(self.payload()).encode()
            retry_headers = self.signed(retry_body)
            self.assert_error(503, "bridge_http_busy", body=retry_body, headers=retry_headers)
            self.assertEqual(self.count_nonces(), 4)
            self.assertEqual([future.result()[0] for future in pending], [200] * 4)
        self.assertEqual(self.request(body=retry_body, headers=retry_headers)[0], 200)

    def test_incomplete_uploads_are_bounded_before_body_hmac_or_helper(self):
        sockets = []
        try:
            for _ in range(bridge.MAX_HANDLERS):
                connection = socket.create_connection(("127.0.0.1", self.port), timeout=3)
                sockets.append(connection)
                headers = self.signed(b"{}")
                lines = ["POST /voltguard-company/v1 HTTP/1.1", "Host: 127.0.0.1", "Content-Length: 2"]
                lines.extend(key + ": " + value for key, value in headers.items())
                # Header-complete real requests intentionally never send body.
                connection.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
            deadline = time.monotonic() + 3
            while self.server.handler_slots._value != 0 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(self.server.handler_slots._value, 0)
            # Admission rejects the accepted socket before reading headers.
            # Read that response directly: uploading an HTTP body races the
            # immediate close and can raise WinError 10053 on the client.
            with socket.create_connection(("127.0.0.1", self.port), timeout=3) as rejected:
                with closing(http.client.HTTPResponse(rejected)) as response:
                    response.begin()
                    result = json.loads(response.read())
                    self.assertEqual(response.status, 503)
                    self.assertEqual(result["protocol"], bridge.PROTOCOL)
                    self.assertIs(result["ok"], False)
                    self.assertEqual(result["code"], "bridge_http_busy")
                    self.assertEqual(response.getheader("Cache-Control"), "no-store")
            self.assertEqual(self.count_nonces(), 0)
            self.assertEqual(self.calls(), [])
        finally:
            for connection in sockets:
                connection.close()
        deadline = time.monotonic() + 3
        while self.server.handler_slots._value != bridge.MAX_HANDLERS and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.server.handler_slots._value, bridge.MAX_HANDLERS)
        self.assertEqual(self.request()[0], 200)

    def test_slow_progress_does_not_reset_absolute_body_deadline(self):
        original = bridge.BODY_TIMEOUT
        bridge.BODY_TIMEOUT = 0.2
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            body = json.dumps(self.payload()).encode()
            connection.putrequest("POST", bridge.ENDPOINT)
            for key, value in self.signed(body).items():
                connection.putheader(key, value)
            connection.putheader("Content-Length", str(len(body)))
            connection.endheaders()
            connection.send(body[:1])
            time.sleep(0.12)
            connection.send(body[1:2])
            # Progress is made within every idle timeout, but the total body
            # deadline must still close this real incomplete socket request.
            time.sleep(0.12)
            response = connection.getresponse()
            self.assertEqual(response.status, 408)
            self.assertEqual(json.loads(response.read())["code"], "bridge_http_body_timeout")
            self.assertEqual(self.count_nonces(), 0)
            self.assertEqual(self.calls(), [])
        finally:
            connection.close()
            bridge.BODY_TIMEOUT = original
        deadline = time.monotonic() + 2
        while self.server.handler_slots._value != bridge.MAX_HANDLERS and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.server.handler_slots._value, bridge.MAX_HANDLERS)
        self.assertEqual(self.request()[0], 200)

    def test_configuration_does_not_allow_listener_injection_or_unknown_fields(self):
        for field, value in (("listenHost", "0.0.0.0"), ("listenPort", 80), ("secret", "not-secret"), ("site", "bad"), ("companyHelper", "relative.py")):
            config = dict(self.fixture_config)
            config[field] = value
            self.source.write_text(json.dumps(config))
            with self.subTest(field=field), self.assertRaises(ValueError):
                bridge.load_config(self.source)
        if os.name == "posix":
            self.source.write_text(json.dumps(self.fixture_config))
            os.chmod(self.source, 0o644)
            with self.assertRaises(ValueError):
                bridge.load_config(self.source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
