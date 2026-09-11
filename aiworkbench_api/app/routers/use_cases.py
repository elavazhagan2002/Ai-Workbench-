import os
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

router = APIRouter()

DEMO_VIDEOS_ROOT = Path(os.getenv("DEMO_VIDEOS_ROOT", "/data/demo_videos"))


def iter_file(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    with path.open("rb", buffering=0) as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.get("/use-cases/{use_case_id}/demo")
async def get_use_case_demo(request: Request, use_case_id: str):
    """
    Stream demo video with HTTP Range support so <video> can seek.
    """
    # If you store a specific demo path in DB, resolve that here instead of hard-coding:
    file_path = DEMO_VIDEOS_ROOT / f"{use_case_id}.mp4"

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Demo video not found")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    # No Range header → send whole file, but still advertise Accept-Ranges
    if range_header is None:
        def full_file():
            with file_path.open("rb", buffering=0) as f:
                while True:
                    data = f.read(1024 * 1024)
                    if not data:
                        break
                    yield data

        return StreamingResponse(
            full_file(),
            status_code=200,
            media_type="video/mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )

    # Parse "Range: bytes=start-end"
    try:
        units, range_value = range_header.split("=", 1)
        if units.strip().lower() != "bytes":
            raise ValueError
        start_str, end_str = range_value.split("-", 1)
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
    except Exception:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    if start >= file_size:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    end = min(end, file_size - 1)
    content_length = end - start + 1

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
    }

    return StreamingResponse(
        iter_file(file_path, start, end),
        status_code=206,  # Partial Content
        media_type="video/mp4",
        headers=headers,
    )
