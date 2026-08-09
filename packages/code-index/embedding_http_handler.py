"""Cancellable HTTP request handling for the local embedding server."""

import gc
import json
import traceback
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable

from embedding_request_registry import EmbeddingRequestRegistry


_server: Any = None
_inference_mode: Callable[[], Any] | None = None
_encode_request: Callable[[list[str], bool, bool, Callable[[], bool]], list[list[float]]] | None = None
_requests = EmbeddingRequestRegistry()
_CANCEL_WAIT_SECONDS = 30.0


def configure(
    server: Any,
    inference_mode: Callable[[], Any],
    encode_request: Callable[
        [list[str], bool, bool, Callable[[], bool]], list[list[float]]
    ],
) -> None:
    global _server, _inference_mode, _encode_request
    _server = server
    _inference_mode = inference_mode
    _encode_request = encode_request


class EmbeddingHttpHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self._json(404, {"error": "not found"})
            return
        if _server is None or _server.model is None:
            self._json(503, {"status": "loading"})
            return
        self._json(
            200,
            {
                **_server.health(),
                "embeddingRequests": {"active": _requests.active_count()},
            },
        )

    def do_POST(self):
        if self.path == "/embed":
            self._embed()
        elif self.path == "/cancel":
            self._cancel()
        else:
            self._json(404, {"error": "not found"})

    def _embed(self):
        if (
            _server is None
            or _server.model is None
            or _inference_mode is None
            or _encode_request is None
        ):
            self._json(503, {"error": "model not loaded"})
            return
        request_id = ""
        try:
            body = self._read_json()
            request_id = body.get("requestId", "")
            texts = body.get("input", [])
            normalize = body.get("normalize", True)
            interactive = body.get("priority") == "interactive"
            if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
                self._json(400, {"error": "valid requestId is required"})
                return
            if not isinstance(texts, list) or not texts:
                self._json(400, {"error": "empty input"})
                return
            cancelled = _requests.register(request_id)
            with _inference_mode():
                embeddings = _encode_request(
                    texts,
                    normalize,
                    interactive,
                    cancelled.is_set,
                )
            self._json(
                200,
                {
                    "requestId": request_id,
                    "model": _server.model_name,
                    "dim": _server.dim,
                    "embeddings": embeddings,
                },
            )
            gc.collect()
        except InterruptedError:
            self._json_best_effort(409, {"requestId": request_id, "cancelled": True})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as error:
            traceback.print_exc()
            self._json_best_effort(500, {"error": str(error)})
        finally:
            if request_id:
                _requests.complete(request_id)

    def _cancel(self):
        try:
            request_id = self._read_json().get("requestId", "")
            if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
                self._json(400, {"error": "valid requestId is required"})
                return
            idle = _requests.cancel_and_wait(request_id, _CANCEL_WAIT_SECONDS)
            self._json(
                200 if idle else 503,
                {"requestId": request_id, "cancelled": True, "idle": idle},
            )
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as error:
            self._json_best_effort(500, {"error": str(error)})

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("request body must be a JSON object")
        return value

    def _json_best_effort(self, code: int, data: dict[str, Any]) -> None:
        try:
            self._json(code, data)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _json(self, code: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass
