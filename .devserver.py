"""Dev-only static server for Fuse Biomechanics.

`python3 -m http.server` calls os.getcwd() at startup, which macOS blocks for
processes spawned by the desktop app (no access to parent directories). This
serves a fixed absolute directory instead and never touches the cwd.
Also sends no-store so edits show up on reload (the app has its own service
worker that would otherwise keep serving stale copies in dev).

Usage: python3 .devserver.py [port]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = "/Users/huangchen/Documents/Claude/2. Fuse-Biomechanics"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8934


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT))
    print(f"Serving {ROOT} on http://localhost:{PORT}", flush=True)
    srv.serve_forever()
