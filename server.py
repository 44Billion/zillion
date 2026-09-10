#!/usr/bin/env python3
import http.server
import socketserver
import os
import signal
import sys
from urllib.parse import urlsplit
from pathlib import Path

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    # Serve HTML/JS/CSS (and related text types) with proper charset=utf-8 headers
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '': 'application/octet-stream',
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.cjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8'
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        # History routes use the app shell; missing assets still return 404.
        route = urlsplit(self.path).path
        if route == '/' or (not Path(route).suffix and not Path(self.translate_path(route)).is_file()):
            self.path = '/index.html'
        return super().do_GET()

def signal_handler(sig, frame):
    print('\nServer stopped gracefully')
    sys.exit(0)

if __name__ == "__main__":
    PORT = 4000
    # Set up signal handler for CTRL+C
    signal.signal(signal.SIGINT, signal_handler)

    # Serve the production build
    project_root = Path(__file__).resolve().parent
    dist_path = project_root / 'dist' / 'zillion'
    if not dist_path.exists():
        print(f'Expected directory not found: {dist_path}')
        sys.exit(1)

    os.chdir(dist_path)

    # Allow address reuse to avoid "Address already in use" errors
    socketserver.TCPServer.allow_reuse_address = True

    with socketserver.TCPServer(("127.0.0.1", PORT), NoCacheHTTPRequestHandler) as httpd:
        print(f"Serving Zillion at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped gracefully')
            httpd.server_close()
