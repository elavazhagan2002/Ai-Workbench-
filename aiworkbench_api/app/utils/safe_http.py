"""HTTP helpers with URL scheme validation for outbound requests."""

from __future__ import annotations

from typing import BinaryIO
from urllib.parse import urlparse
from urllib.request import Request, urlopen

_ALLOWED_SCHEMES = frozenset({"http", "https"})


def open_http_request(request: Request, *, timeout: float) -> BinaryIO:
    """Open an HTTP(S) request after validating the URL scheme."""
    scheme = urlparse(request.full_url).scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise ValueError(f"Unsupported URL scheme: {scheme}")
    return urlopen(request, timeout=timeout)  # nosec B310
