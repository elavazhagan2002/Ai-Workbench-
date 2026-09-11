"""High-fidelity PPT/PPTX and XLS/XLSX previews via Aspose.

Renders slides and worksheets to PNG with Aspose.Slides / Aspose.Cells
(Python via .NET). Microsoft Office and LibreOffice are not required.
Without a license Aspose still converts, with an evaluation watermark.
"""

from __future__ import annotations

import base64
import os
import sys
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from html import escape
from io import BytesIO
from pathlib import Path

from app.core.config import settings
from app.core.logging_config import logger

MAX_PRESENTATION_SLIDES = 80
MAX_SPREADSHEET_SHEETS = 25
SLIDE_RENDER_SCALE = 1.5
SHEET_RENDER_DPI = 144

_license_lock = threading.Lock()
_licenses_applied = False
_import_logged = False


def convert_office_preview_html(category: str, file_name: str, content: bytes) -> str | None:
    """Render an Office file to a self-contained HTML image gallery.

    Returns None when Aspose is disabled, missing, or conversion fails.
    """
    if not settings.ASPOSE_PREVIEW_ENABLED:
        return None
    if not content:
        return None
    if not _aspose_available():
        return None

    category = (category or "").upper()
    try:
        _apply_licenses_once()
        if category == "PPT":
            return _convert_presentation_to_html(file_name, content)
        if category == "XLS":
            return _convert_workbook_to_html(file_name, content)
    except Exception as exc:
        logger.warning("Aspose %s preview failed for %s: %s", category, file_name, exc)
        return None
    return None


def _aspose_available() -> bool:
    global _import_logged
    try:
        import aspose.slides  # noqa: F401
        from aspose.cells import Workbook  # noqa: F401
        return True
    except Exception as exc:
        if not _import_logged:
            logger.error(
                "Aspose preview libraries are not available in this Python (%s). "
                "Install aspose-slides and aspose-cells-python into the same interpreter that runs uvicorn. Error: %s",
                sys.executable,
                exc,
            )
            _import_logged = True
        return False


def _apply_licenses_once() -> None:
    global _licenses_applied
    if _licenses_applied:
        return
    with _license_lock:
        if _licenses_applied:
            return
        slides_path = settings.get_aspose_slides_license_path()
        cells_path = settings.get_aspose_cells_license_path()
        if slides_path:
            _set_slides_license(slides_path)
        else:
            logger.info("Aspose.Slides is running in evaluation mode (no license file).")
        if cells_path:
            _set_cells_license(cells_path)
        else:
            logger.info("Aspose.Cells is running in evaluation mode (no license file).")
        _licenses_applied = True


def _set_slides_license(path: Path) -> None:
    try:
        import aspose.slides as slides

        license = slides.License()
        license.set_license(str(path))
        licensed = bool(getattr(license, "is_licensed", False))
        logger.info("Aspose.Slides license applied from %s (licensed=%s)", path, licensed)
    except Exception as exc:
        logger.warning("Failed to apply Aspose.Slides license %s: %s", path, exc)


def _set_cells_license(path: Path) -> None:
    try:
        from aspose.cells import License

        license = License()
        license.set_license(str(path))
        logger.info("Aspose.Cells license applied from %s", path)
    except Exception as exc:
        logger.warning("Failed to apply Aspose.Cells license %s: %s", path, exc)


@contextmanager
def _temp_file(suffix: str, data: bytes | None = None) -> Iterator[str]:
    fd, name = tempfile.mkstemp(suffix=suffix)
    try:
        try:
            if data is not None:
                os.write(fd, data)
        finally:
            os.close(fd)
        yield name
    finally:
        try:
            os.unlink(name)
        except OSError:
            pass


def _file_extension(file_name: str) -> str:
    name = (file_name or "").lower()
    for extension in (".pptx", ".ppt", ".xlsx", ".xls"):
        if name.endswith(extension):
            return extension
    return Path(name).suffix.lower()


def _png_data_uri(png_bytes: bytes) -> str:
    encoded = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _gallery_html(title: str, cards: list[str], extra_css: str = "") -> str:
    body = "".join(cards) or "<p class=\"preview-empty\">No preview pages were generated.</p>"
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{escape(title)}</title><style>"
        "html,body{margin:0;background:#e8edf4;color:#111827;"
        "font-family:'Segoe UI',Tahoma,sans-serif;}"
        ".preview-wrap{padding:16px 16px 40px;}"
        ".preview-kicker{margin:0 0 14px;font-size:12px;color:#4b5563;}"
        ".preview-empty{margin:24px;color:#6b7280;}"
        ".preview-card{width:100%;max-width:1200px;margin:0 auto 28px;}"
        ".preview-card figcaption,.preview-card h2{margin:0 0 8px;font-size:12px;"
        "font-weight:600;color:#4b5563;letter-spacing:.02em;}"
        ".preview-card img{width:100%;height:auto;display:block;background:#fff;"
        "border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.16);}"
        f"{extra_css}"
        "</style></head><body><div class=\"preview-wrap\">"
        f"<p class=\"preview-kicker\">{escape(title)}</p>"
        f"{body}</div></body></html>"
    )


def _convert_presentation_to_html(file_name: str, content: bytes) -> str:
    import aspose.slides as slides

    is_zip = content.startswith(b"PK")
    suffix = _file_extension(file_name)
    if suffix not in {".ppt", ".pptx"}:
        suffix = ".pptx" if is_zip else ".ppt"

    cards: list[str] = []
    rendered = 0
    truncated = False
    with _temp_file(suffix, content) as source_path:
        with slides.Presentation(source_path) as presentation:
            slide_count = len(presentation.slides)
            if slide_count <= 0:
                raise ValueError("Presentation contains no slides")
            for index, slide in enumerate(presentation.slides, start=1):
                if index > MAX_PRESENTATION_SLIDES:
                    break
                image = slide.get_image(SLIDE_RENDER_SCALE, SLIDE_RENDER_SCALE)
                try:
                    buffer = BytesIO()
                    image.save(buffer, slides.ImageFormat.PNG)
                    png_bytes = buffer.getvalue()
                finally:
                    dispose = getattr(image, "dispose", None)
                    if callable(dispose):
                        dispose()
                if not png_bytes.startswith(b"\x89PNG"):
                    raise ValueError(f"Slide {index} did not render as PNG")
                cards.append(
                    f'<figure class="preview-card"><figcaption>Slide {index}</figcaption>'
                    f'<img alt="Slide {index}" src="{_png_data_uri(png_bytes)}" /></figure>'
                )
                rendered = index
            truncated = slide_count > MAX_PRESENTATION_SLIDES

    title = f"Presentation preview · {file_name}"
    if truncated:
        title += f" (first {MAX_PRESENTATION_SLIDES} slides)"
    logger.info("Aspose.Slides rendered %s slides from %s", rendered, file_name)
    return _gallery_html(title, cards)


def _convert_workbook_to_html(file_name: str, content: bytes) -> str:
    from aspose.cells import GridlineType, Workbook
    from aspose.cells.rendering import ImageOrPrintOptions, SheetRender

    is_zip = content.startswith(b"PK")
    suffix = _file_extension(file_name)
    if suffix not in {".xls", ".xlsx"}:
        suffix = ".xlsx" if is_zip else ".xls"

    cards: list[str] = []
    workbook = None
    with _temp_file(suffix, content) as source_path:
        workbook = Workbook(source_path)
        try:
            try:
                workbook.calculate_formula()
            except Exception as exc:
                logger.info("Aspose.Cells formula calculation skipped for %s: %s", file_name, exc)

            sheet_count = len(workbook.worksheets)
            while sheet_count > MAX_SPREADSHEET_SHEETS:
                workbook.worksheets.remove_at(sheet_count - 1)
                sheet_count -= 1

            options = ImageOrPrintOptions()
            options.one_page_per_sheet = True
            options.all_columns_in_one_page_per_sheet = True
            options.horizontal_resolution = SHEET_RENDER_DPI
            options.vertical_resolution = SHEET_RENDER_DPI
            options.gridline_type = GridlineType.HAIR
            options.output_blank_page_when_nothing_to_print = False

            for index in range(sheet_count):
                sheet = workbook.worksheets[index]
                page_setup = sheet.page_setup
                page_setup.print_gridlines = True
                page_setup.print_headings = True
                page_setup.fit_to_pages_wide = 1
                page_setup.fit_to_pages_tall = 0

                renderer = SheetRender(sheet, options)
                try:
                    pages = max(1, int(renderer.page_count or 0))
                    sheet_images: list[str] = []
                    for page_index in range(pages):
                        with _temp_file(".png") as png_path:
                            renderer.to_image(page_index, png_path)
                            png_bytes = Path(png_path).read_bytes()
                        if not png_bytes.startswith(b"\x89PNG"):
                            continue
                        caption = escape(sheet.name or f"Sheet {index + 1}")
                        if pages > 1:
                            caption = f"{caption} · page {page_index + 1}"
                        sheet_images.append(
                            f'<figure class="preview-card"><figcaption>{caption}</figcaption>'
                            f'<img alt="{caption}" src="{_png_data_uri(png_bytes)}" /></figure>'
                        )
                    if sheet_images:
                        cards.extend(sheet_images)
                    else:
                        cards.append(
                            f'<section class="preview-card"><h2>{escape(sheet.name)}</h2>'
                            '<p class="preview-empty">This sheet is empty.</p></section>'
                        )
                finally:
                    dispose = getattr(renderer, "dispose", None)
                    if callable(dispose):
                        dispose()
        finally:
            dispose = getattr(workbook, "dispose", None)
            if callable(dispose):
                dispose()

    logger.info("Aspose.Cells rendered %s sheets from %s", len(cards), file_name)
    return _gallery_html(f"Spreadsheet preview · {file_name}", cards)
