#!/usr/bin/env python3
"""
Local embedding server for code-index.

Uses sentence-transformers to run Qwen3-Embedding-0.6B on CPU/Metal.

Usage:
    python embedding_server.py [--port 18742] [--model Qwen/Qwen3-Embedding-0.6B]

API:
    POST /embed
    Body: {"input": ["text1", "text2"], "normalize": true}
    Response: {"model": "...", "dim": 1024, "embeddings": [[...], [...]]}

    GET /health
    Response: {"status": "ready", "model": "..."}
"""

import argparse
import json
import os
import sys
import threading
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from typing import List

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

try:
    import torch
    from sentence_transformers import SentenceTransformer
except ImportError:
    print(
        "ERROR: sentence-transformers not installed.\n"
        "  pip install sentence-transformers transformers torch",
        file=sys.stderr,
    )
    sys.exit(1)


class EmbeddingServer:
    def __init__(self, model_name: str = "Qwen/Qwen3-Embedding-0.6B"):
        self.model_name = model_name
        self.model = None
        self.dim = 1024

    def load(self):
        print(f"Loading model: {self.model_name}", flush=True)
        device = None
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"

        self.model = SentenceTransformer(self.model_name, device=device) if device else SentenceTransformer(self.model_name)
        # Bound memory use across Metal, CUDA, and CPU environments.
        self.model.max_seq_length = 512
        # Sample encode to determine dim
        sample = self.model.encode(["probe"])
        self.dim = sample.shape[-1]
        print(
            f"Model loaded. Dim: {self.dim}, max_seq: 512, device: {self.model.device}",
            flush=True,
        )


server: EmbeddingServer | None = None
encode_lock: threading.Lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            if server is None or server.model is None:
                self._json(503, {"status": "loading"})
            else:
                self._json(200, {"status": "ready", "model": server.model_name, "dim": server.dim})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._json(404, {"error": "not found"})
            return

        if server is None or server.model is None:
            self._json(503, {"error": "model not loaded"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            texts: List[str] = body.get("input", [])
            normalize = body.get("normalize", True)

            if not texts:
                self._json(400, {"error": "empty input"})
                return

            with encode_lock:
                with torch.inference_mode():
                    embeddings = server.model.encode(
                        texts,
                        normalize_embeddings=normalize,
                        batch_size=16,
                        show_progress_bar=False,
                    )
            self._json(200, {
                "model": server.model_name,
                "dim": server.dim,
                "embeddings": embeddings.tolist(),
            })
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": str(e)})

    def _json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # silence request logs


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def server_close(self):
        try:
            super().server_close()
        except OSError:
            pass  # Ignore "Cannot assign requested address" on close


def main():
    parser = argparse.ArgumentParser(description="Embedding server for code-index")
    parser.add_argument("--port", type=int, default=18742)
    parser.add_argument("--model", default="Qwen/Qwen3-Embedding-0.6B")
    args = parser.parse_args()

    global server
    server = EmbeddingServer(args.model)
    server.load()

    addr = ("127.0.0.1", args.port)
    httpd = ThreadedHTTPServer(addr, Handler)
    print(f"Embedding server listening on http://{addr[0]}:{addr[1]} (threaded)", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
