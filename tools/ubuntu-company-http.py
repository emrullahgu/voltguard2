#!/usr/bin/env python3
"""Loopback-only authenticated transport for the existing private CLI helpers.

TLS is terminated by the existing reverse proxy. Never expose this listener or
the CLI helpers directly, and never log request bodies or authentication data.
"""
import argparse
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENDPOINT = "/voltguard-company/v1"
PROTOCOL = "vg-ubuntu-company/1"
MAX_BODY = 32 * 1024 * 1024
MAX_RESPONSE = 128 * 1024 * 1024
MAX_SKEW = 60
HELPER_TIMEOUT = 45
MAX_CONCURRENT = 4
MAX_HANDLERS = 8
BODY_TIMEOUT = 15
HEX32 = re.compile(r"[a-f0-9]{32}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


class BridgeError(Exception):
    def __init__(self, code, status=503):
        self.code, self.status = code, status


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def decode_json(raw):
    def invalid_constant(_):
        raise ValueError("nonfinite JSON")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)


def encode_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def load_config(filename):
    path = Path(filename).absolute()
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise ValueError("invalid private configuration")
    if os.name == "posix" and path.stat().st_mode & 0o077:
        raise ValueError("configuration must be private")
    config = decode_json(path.read_bytes())
    required = {"version", "keyId", "secret", "site", "companyHelper", "sahaHelper"}
    if not isinstance(config, dict) or not required <= set(config) or set(config) - required - {"listenPort"}:
        raise ValueError("invalid configuration fields")
    if type(config["version"]) is not int or config["version"] != 1:
        raise ValueError("invalid configuration version")
    if not isinstance(config["keyId"], str) or not KEY_ID.fullmatch(config["keyId"]):
        raise ValueError("invalid key identifier")
    if not isinstance(config["secret"], str) or not HEX64.fullmatch(config["secret"]):
        raise ValueError("invalid secret")
    if not isinstance(config["site"], str) or not HEX32.fullmatch(config["site"]):
        raise ValueError("invalid site")
    port = config.get("listenPort", 19187)
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("invalid loopback port")
    helpers = {}
    for route, key in (("company", "companyHelper"), ("saha", "sahaHelper")):
        value = config[key]
        if not isinstance(value, str):
            raise ValueError("invalid helper")
        helper = Path(value)
        if not helper.is_absolute() or helper.suffix != ".py" or helper.is_symlink() or not helper.is_file():
            raise ValueError("invalid helper")
        helpers[route] = (str(helper), str(helper.parent / ("saha-config.json" if route == "saha" else "config.json")))
    return {"keyId": config["keyId"], "secret": bytes.fromhex(config["secret"]),
            "site": config["site"], "port": port, "helpers": helpers,
            "nonceFile": str(path.with_name(path.name + ".nonces.sqlite3"))}


def canonical(key_id, timestamp, nonce, raw):
    return ("POST\n" + ENDPOINT + "\n" + key_id + "\n" + timestamp + "\n" + nonce + "\n" +
            hashlib.sha256(raw).hexdigest()).encode("ascii")


class NonceStore:
    """Persistent replay fence shared by concurrent handlers and restarts."""
    def __init__(self, filename):
        self.filename = filename
        path = Path(filename)
        if path.is_symlink():
            raise ValueError("invalid replay store")
        # Create privately before SQLite opens it, including on a shared umask.
        fd = os.open(filename, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(filename, 0o600)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS nonces (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS nonces_expiry ON nonces(expires)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.filename, timeout=2)
        try:
            with db:
                yield db
        finally:
            db.close()

    def consume(self, key_id, nonce, timestamp, now):
        try:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("DELETE FROM nonces WHERE expires < ?", (now,))
                try:
                    db.execute("INSERT INTO nonces(id,expires) VALUES (?,?)",
                               (key_id + ":" + nonce, timestamp + MAX_SKEW + 1))
                except sqlite3.IntegrityError:
                    raise BridgeError("bridge_http_replay", 403) from None
        except sqlite3.Error:
            raise BridgeError("bridge_http_replay_store", 503) from None


def stop_helper(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def execute_helper(helper, config_path, request):
    """Bounded disk-backed I/O; a noisy helper cannot fill process memory."""
    process = None
    with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as output:
        source.write(encode_json(request))
        source.seek(0)
        try:
            process = subprocess.Popen([sys.executable, helper, "--config", config_path],
                                       stdin=source, stdout=output, stderr=subprocess.DEVNULL,
                                       shell=False, start_new_session=(os.name == "posix"))
            deadline = time.monotonic() + HELPER_TIMEOUT
            while process.poll() is None:
                if os.fstat(output.fileno()).st_size > MAX_RESPONSE:
                    raise BridgeError("bridge_http_response_size", 503)
                if time.monotonic() >= deadline:
                    raise BridgeError("bridge_http_timeout", 503)
                time.sleep(0.02)
            if process.returncode != 0:
                raise BridgeError("bridge_http_helper", 503)
            if os.fstat(output.fileno()).st_size > MAX_RESPONSE:
                raise BridgeError("bridge_http_response_size", 503)
            output.seek(0)
            raw = output.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise BridgeError("bridge_http_response_size", 503)
            try:
                result = decode_json(raw)
            except (ValueError, UnicodeError, RecursionError):
                raise BridgeError("bridge_http_helper_response", 503) from None
            if not isinstance(result, dict) or result.get("protocol") != PROTOCOL or type(result.get("ok")) is not bool:
                raise BridgeError("bridge_http_helper_response", 503)
            return raw
        except (OSError, subprocess.SubprocessError):
            raise BridgeError("bridge_http_helper", 503) from None
        finally:
            if process is not None:
                stop_helper(process)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, config):
        self.config = config
        self.slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self.handler_slots = threading.BoundedSemaphore(MAX_HANDLERS)
        self.nonces = NonceStore(config["nonceFile"])
        super().__init__(("127.0.0.1", config["port"]), BridgeHandler)

    def process_request(self, request, client_address):
        # Bound connections before a worker thread, headers or request body are
        # allocated. HMAC must cover the body, so its validation alone cannot
        # protect an unbounded thread-per-upload HTTP server.
        if not self.handler_slots.acquire(blocking=False):
            raw = encode_json({"protocol": PROTOCOL, "ok": False,
                               "code": "bridge_http_busy", "error": "bridge_http_busy", "status": 503})
            try:
                request.settimeout(1)
                request.sendall(("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n"
                                 "Cache-Control: no-store\r\nConnection: close\r\nContent-Length: " +
                                 str(len(raw)) + "\r\n\r\n").encode("ascii") + raw)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.handler_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.handler_slots.release()

    def handle_error(self, request, client_address):
        # A disconnected client must not turn a traceback into an access log.
        pass


class BridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VoltGuardBridge"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        # Neither HTTP access logs nor helper stderr may contain credentials,
        # request bodies, database details or personal records.
        pass

    def send_json(self, status, code):
        raw = encode_json({"protocol": PROTOCOL, "ok": False, "code": code,
                           "error": code, "status": status})
        self.send_raw(status, raw)

    def send_raw(self, status, raw):
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def send_error(self, code, message=None, explain=None):
        # BaseHTTPRequestHandler also uses this for malformed HTTP input.
        self.send_json(code, "bridge_http_request")

    def handle_expect_100(self):
        # Never invite a large unauthenticated upload before the HMAC checks.
        self.send_json(417, "bridge_http_expect")
        return False

    def one_header(self, name):
        values = self.headers.get_all(name, [])
        if len(values) != 1:
            raise BridgeError("bridge_http_auth", 401)
        return values[0]

    def authenticate_headers(self):
        key = self.one_header("X-VG-Bridge-Key")
        stamp = self.one_header("X-VG-Bridge-Time")
        nonce = self.one_header("X-VG-Bridge-Nonce")
        signature = self.one_header("X-VG-Bridge-Signature")
        if not KEY_ID.fullmatch(key) or not hmac.compare_digest(key, self.server.config["keyId"]):
            raise BridgeError("bridge_http_auth", 401)
        if not re.fullmatch(r"[0-9]{10,11}", stamp) or abs(int(time.time()) - int(stamp)) > MAX_SKEW:
            raise BridgeError("bridge_http_auth", 401)
        if not HEX32.fullmatch(nonce) or not HEX64.fullmatch(signature):
            raise BridgeError("bridge_http_auth", 401)
        return key, stamp, nonce, signature

    def read_body(self, size):
        # Socket idle timeouts alone can be reset indefinitely by a trickle.
        # read1 performs at most one underlying read, allowing us to enforce a
        # single absolute deadline across all body chunks.
        deadline = time.monotonic() + BODY_TIMEOUT
        data = bytearray()
        while len(data) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise BridgeError("bridge_http_body_timeout", 408)
            self.connection.settimeout(remaining)
            try:
                chunk = self.rfile.read1(min(65536, size - len(data)))
            except TimeoutError:
                raise BridgeError("bridge_http_body_timeout", 408) from None
            if not chunk:
                raise BridgeError("bridge_http_body", 400)
            data.extend(chunk)
        if time.monotonic() > deadline:
            raise BridgeError("bridge_http_body_timeout", 408)
        self.connection.settimeout(15)
        return bytes(data)

    def do_POST(self):
        try:
            if self.path != ENDPOINT:
                raise BridgeError("bridge_http_path", 404)
            key, stamp, nonce, signature = self.authenticate_headers()
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]) or self.headers.get("Transfer-Encoding") is not None:
                raise BridgeError("bridge_http_length", 400)
            size = int(lengths[0])
            if size > MAX_BODY:
                raise BridgeError("bridge_http_body_size", 413)
            if size == 0:
                raise BridgeError("bridge_http_body", 400)
            if self.headers.get("Content-Encoding") is not None or self.headers.get_content_type() != "application/json":
                raise BridgeError("bridge_http_content_type", 415)
            raw = self.read_body(size)
            expected = hmac.new(self.server.config["secret"], canonical(key, stamp, nonce, raw), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise BridgeError("bridge_http_auth", 401)
            try:
                envelope = decode_json(raw)
            except (ValueError, UnicodeError, RecursionError):
                raise BridgeError("bridge_http_body", 400) from None
            if not isinstance(envelope, dict) or set(envelope) != {"route", "request"}:
                raise BridgeError("bridge_http_envelope", 400)
            route, request = envelope["route"], envelope["request"]
            if not isinstance(route, str) or route not in self.server.config["helpers"]:
                raise BridgeError("bridge_http_route", 403)
            allowed_ops = {"health", "snapshot", "commit"} | ({"file"} if route == "saha" else set())
            if not isinstance(request, dict) or not isinstance(request.get("op"), str) or request["op"] not in allowed_ops:
                raise BridgeError("bridge_http_operation", 403)
            site = request.get("site")
            if not isinstance(site, str) or not HEX32.fullmatch(site) or not hmac.compare_digest(site, self.server.config["site"]):
                raise BridgeError("bridge_http_site", 403)
            if not self.server.slots.acquire(blocking=False):
                raise BridgeError("bridge_http_busy", 503)
            try:
                # Re-check clock after body transfer before persisting a nonce.
                now = int(time.time())
                if abs(now - int(stamp)) > MAX_SKEW:
                    raise BridgeError("bridge_http_auth", 401)
                self.server.nonces.consume(key, nonce, int(stamp), now)
                helper, config_path = self.server.config["helpers"][route]
                response = execute_helper(helper, config_path, request)
            finally:
                self.server.slots.release()
            self.send_raw(200, response)
        except BridgeError as error:
            self.send_json(error.status, error.code)
        except (OSError, ValueError, TypeError, RecursionError):
            self.send_json(503, "bridge_http_unavailable")

    def reject_method(self):
        self.send_json(405 if self.path == ENDPOINT else 404,
                       "bridge_http_method" if self.path == ENDPOINT else "bridge_http_path")

    do_GET = do_HEAD = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = do_CONNECT = reject_method


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Private JSON configuration outside the web root")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        server = BridgeServer(load_config(args.config))
    except (OSError, ValueError, sqlite3.Error):
        # Deliberately do not echo filenames, secrets or private config values.
        print("VoltGuard bridge configuration unavailable", file=sys.stderr)
        return 1
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
