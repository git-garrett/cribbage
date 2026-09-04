#!/usr/bin/env python3
import http.client
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


ROOT = os.environ.get(
    "CRIBBAGE_LOCAL_DIST",
    "/private/tmp/strong-cribbage-local-runtime/dist",
)
API_HOST = "127.0.0.1"
API_PORT = 8787


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/health" or self.path.startswith("/api/"):
            self.proxy()
            return
        path = urlsplit(self.path).path
        target = self.translate_path(path)
        if not os.path.exists(target) and "." not in os.path.basename(path):
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):
        if self.path == "/health" or self.path.startswith("/api/"):
            self.proxy()
            return
        super().do_HEAD()

    def do_POST(self):
        self.proxy()

    def do_OPTIONS(self):
        self.proxy()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def proxy(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        forwarded = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "connection", "content-length"}
        }
        connection = http.client.HTTPConnection(API_HOST, API_PORT, timeout=120)
        try:
            connection.request(self.command, self.path, body=body, headers=forwarded)
            response = connection.getresponse()
            payload = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except Exception as error:
            payload = ("Local API unavailable: " + str(error)).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        finally:
            connection.close()

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args), flush=True)


ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
