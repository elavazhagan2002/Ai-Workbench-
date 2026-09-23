"""Convert uploaded use-case resources into safe in-app HTML previews."""

from __future__ import annotations

import base64
import io
import re
import struct
from dataclasses import dataclass
from datetime import date, datetime, time
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

from app.core.logging_config import logger

MAX_EMBEDDED_IMAGE_BYTES = 4_000_000
MAX_PRESENTATION_SLIDES = 80
MAX_SPREADSHEET_SHEETS = 25
MAX_SPREADSHEET_ROWS = 250
MAX_SPREADSHEET_COLS = 40

_CSS_DANGEROUS_RE = re.compile(
    r"expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding\s*:|behavior\s*:|@charset",
    re.IGNORECASE,
)
_CSS_URL_RE = re.compile(r"url\s*\(\s*(['\"]?)(.*?)(\1)\s*\)", re.IGNORECASE | re.DOTALL)
_SAFE_ATTR_NAME_RE = re.compile(r"^[a-zA-Z_:][-a-zA-Z0-9_:.]*$")
_SAFE_DATA_ATTR_RE = re.compile(r"^data-[a-zA-Z0-9_-]+$")
_SAFE_ARIA_ATTR_RE = re.compile(r"^aria-[a-zA-Z0-9_-]+$")


def decode_text_content(content: bytes) -> str:
    """Decode text-like file content for HTML preview sanitization."""
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _sanitize_url(value: str, *, allow_relative: bool = True) -> str | None:
    value = (value or "").strip()
    if not value:
        return None

    lowered = value.lower()
    if lowered.startswith(("javascript:", "vbscript:", "file:", "blob:")):
        return None
    if lowered.startswith("data:text/html") or lowered.startswith("data:application/xhtml"):
        return None
    if value.startswith("//"):
        return None

    parsed = urlparse(value)
    scheme = (parsed.scheme or "").lower()
    if not scheme:
        if value.startswith("#") or allow_relative:
            return value
        return None
    if scheme in {"http", "https", "mailto"}:
        return value
    if scheme == "data":
        if lowered.startswith("data:image/") or lowered.startswith("data:font/") or "font" in lowered.split(";", 1)[0]:
            return value
        return None
    return None


def sanitize_css(css: str) -> str:
    """Strip scripted CSS while keeping layout rules, fonts, and gradient/image URLs."""
    css = css.replace("</", "<\\/")
    css = _CSS_DANGEROUS_RE.sub("invalid(", css)

    def _replace_url(match: re.Match[str]) -> str:
        raw_url = (match.group(2) or "").strip().strip("'\"")
        sanitized = _sanitize_url(raw_url)
        if not sanitized:
            return "none"
        safe = sanitized.replace("\\", "/").replace('"', "%22")
        return f'url("{safe}")'

    return _CSS_URL_RE.sub(_replace_url, css)


class SafeHTMLPreviewSanitizer(HTMLParser):
    """HTML sanitizer that preserves rich CSS/layout while blocking active content."""

    allowed_tags = {
        "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
        "caption", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div",
        "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5",
        "h6", "header", "hgroup", "hr", "i", "img", "ins", "kbd", "label", "legend", "li",
        "main", "mark", "nav", "ol", "p", "picture", "pre", "q", "rp", "rt", "ruby", "s",
        "samp", "section", "small", "source", "span", "strong", "sub", "summary", "sup",
        "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
        "center", "font", "big", "strike", "tt", "fieldset",
        "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
        "text", "tspan", "defs", "clippath", "lineargradient", "radialgradient", "stop",
        "use", "symbol", "view", "image", "title", "desc", "marker", "pattern", "mask",
        "switch", "filter", "fegaussianblur", "feflood", "feoffset", "fecomposite",
        "femerge", "femergenode", "feblend", "fecolormatrix", "fecomponenttransfer",
        "feimage", "feclippath",
    }
    void_tags = {"br", "hr", "img", "col", "source", "wbr"}
    drop_content_tags = {
        "script", "iframe", "object", "embed", "applet", "frame", "frameset", "base",
        "form", "input", "button", "textarea", "select", "option", "optgroup", "math",
        "foreignobject", "animate", "set", "handler", "video", "audio", "canvas",
        "noscript", "template",
    }
    global_attrs = {
        "class", "id", "title", "lang", "dir", "role", "style", "hidden", "tabindex",
        "width", "height", "align", "valign", "bgcolor", "color", "border", "cellpadding",
        "cellspacing", "background",
    }
    tag_attrs = {
        "a": {"href", "target", "rel", "name"},
        "img": {"src", "alt", "srcset", "sizes", "loading", "decoding"},
        "source": {"src", "srcset", "sizes", "type", "media"},
        "td": {"colspan", "rowspan", "headers", "scope"},
        "th": {"colspan", "rowspan", "headers", "scope"},
        "ol": {"start", "type", "reversed"},
        "ul": {"type"},
        "li": {"value"},
        "col": {"span"},
        "colgroup": {"span"},
        "table": {"summary"},
        "font": {"size", "face", "color"},
        "svg": {
            "viewbox", "xmlns", "fill", "stroke", "preserveaspectratio", "version",
            "overflow", "xmlns:xlink",
        },
        "path": {"d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform", "fill-rule", "clip-rule"},
        "rect": {"x", "y", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"},
        "circle": {"cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity", "transform"},
        "ellipse": {"cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"},
        "line": {"x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity", "transform"},
        "polyline": {"points", "fill", "stroke", "stroke-width", "opacity", "transform"},
        "polygon": {"points", "fill", "stroke", "stroke-width", "opacity", "transform"},
        "g": {"fill", "stroke", "opacity", "transform", "clip-path"},
        "text": {"x", "y", "dx", "dy", "fill", "stroke", "font-size", "font-family", "text-anchor", "transform", "opacity"},
        "tspan": {"x", "y", "dx", "dy", "fill", "font-size", "text-anchor"},
        "lineargradient": {"id", "x1", "y1", "x2", "y2", "gradientunits", "gradienttransform"},
        "radialgradient": {"id", "cx", "cy", "r", "fx", "fy", "gradientunits", "gradienttransform"},
        "stop": {"offset", "stop-color", "stop-opacity"},
        "use": {"href", "xlink:href", "x", "y", "width", "height", "transform"},
        "image": {"href", "xlink:href", "x", "y", "width", "height", "preserveaspectratio", "transform"},
        "clippath": {"id", "clippathunits", "transform"},
        "filter": {"id", "x", "y", "width", "height", "filterunits", "primitiveunits"},
        "marker": {"id", "markerwidth", "markerheight", "refx", "refy", "orient", "markerunits"},
        "pattern": {"id", "x", "y", "width", "height", "patternunits", "patterntransform", "viewbox"},
        "mask": {"id", "x", "y", "width", "height", "maskunits"},
        "symbol": {"id", "viewbox", "preserveaspectratio"},
        "view": {"id", "viewbox"},
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.html_attrs: list[tuple[str, str]] = []
        self.body_attrs: list[tuple[str, str]] = []
        self.head_parts: list[str] = []
        self.body_parts: list[str] = []
        self._drop_depth = 0
        self._style_depth = 0
        self._style_chunks: list[str] = []
        self._in_head = False
        self._in_body = False

    def _destination(self) -> list[str]:
        if self._in_head and not self._in_body:
            return self.head_parts
        return self.body_parts

    def _is_attr_allowed(self, tag: str, attr_name: str) -> bool:
        if attr_name in self.global_attrs:
            return True
        if attr_name in self.tag_attrs.get(tag, set()):
            return True
        if _SAFE_DATA_ATTR_RE.match(attr_name) or _SAFE_ARIA_ATTR_RE.match(attr_name):
            return True
        if attr_name.startswith("stroke-") or attr_name.startswith("fill-") or attr_name.startswith("font-"):
            return tag in {
                "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
                "polygon", "text", "tspan", "stop", "use", "image",
            }
        return False

    def _clean_attrs(self, tag: str, attrs) -> list[tuple[str, str]]:
        cleaned: list[tuple[str, str]] = []
        for attr_name, attr_value in attrs:
            attr_name = (attr_name or "").lower().strip()
            if not attr_name or attr_name.startswith("on") or attr_name in {"formaction", "form", "xlink:actuate"}:
                continue
            if not _SAFE_ATTR_NAME_RE.match(attr_name) and not _SAFE_DATA_ATTR_RE.match(attr_name):
                continue
            if not self._is_attr_allowed(tag, attr_name):
                continue
            if attr_value is None:
                cleaned.append((attr_name, attr_name))
                continue
            attr_value = str(attr_value).strip()
            if attr_name == "style":
                attr_value = sanitize_css(attr_value)
                if not attr_value:
                    continue
            elif attr_name in {"href", "src", "xlink:href", "poster", "background"}:
                if tag == "use" or (tag == "image" and attr_value.startswith("#")):
                    if not attr_value.startswith("#"):
                        attr_value = _sanitize_url(attr_value) or ""
                    if not attr_value:
                        continue
                else:
                    attr_value = _sanitize_url(attr_value) or ""
                    if not attr_value:
                        continue
            elif attr_name == "srcset":
                attr_value = self._sanitize_srcset(attr_value) or ""
                if not attr_value:
                    continue
            elif attr_name == "target":
                if attr_value.lower() not in {"_blank", "_self"}:
                    continue
            cleaned.append((attr_name, attr_value))
        return cleaned

    @staticmethod
    def _sanitize_srcset(value: str) -> str | None:
        parts: list[str] = []
        for item in value.split(","):
            item = item.strip()
            if not item:
                continue
            bits = item.split()
            url = _sanitize_url(bits[0])
            if not url:
                continue
            descriptor = " ".join(bits[1:]).strip()
            parts.append(f"{url} {descriptor}".strip())
        return ", ".join(parts) if parts else None

    @staticmethod
    def _attrs_html(attrs: list[tuple[str, str]]) -> str:
        return "".join(f' {name}="{escape(value, quote=True)}"' for name, value in attrs)

    def handle_starttag(self, tag: str, attrs):
        tag = (tag or "").lower()
        if tag == "html":
            self.html_attrs = self._clean_attrs("div", attrs)
            return
        if tag == "head":
            self._in_head = True
            return
        if tag == "body":
            self._in_head = False
            self._in_body = True
            self.body_attrs = self._clean_attrs("div", attrs)
            return
        if tag == "meta":
            if self._drop_depth > 0:
                return
            meta = {name.lower(): (value or "") for name, value in attrs}
            http_equiv = meta.get("http-equiv", "").lower()
            if http_equiv in {"refresh", "content-security-policy", "set-cookie"}:
                return
            allowed_meta = {}
            if meta.get("charset"):
                allowed_meta["charset"] = meta["charset"]
            if meta.get("name", "").lower() == "viewport" and meta.get("content"):
                allowed_meta = {"name": "viewport", "content": meta["content"]}
            if allowed_meta:
                self.head_parts.append(f"<meta{self._attrs_html(list(allowed_meta.items()))}>")
            return
        if tag == "link":
            if self._drop_depth > 0:
                return
            rel = ""
            href = ""
            extra: list[tuple[str, str]] = []
            for name, value in attrs:
                name = (name or "").lower()
                value = (value or "").strip()
                if name == "rel":
                    rel = value.lower()
                elif name == "href":
                    href = value
                elif name in {"media", "type", "crossorigin", "as", "integrity", "referrerpolicy"}:
                    extra.append((name, value))
            if rel not in {"stylesheet", "preload"} and "stylesheet" not in rel:
                return
            href = _sanitize_url(href) or ""
            if not href:
                return
            extra_html = self._attrs_html(extra)
            self.head_parts.append(f'<link rel="stylesheet" href="{escape(href, quote=True)}"{extra_html}>')
            return
        if tag == "style":
            if self._drop_depth > 0:
                return
            self._style_depth += 1
            self._style_chunks = []
            return
        if tag in self.drop_content_tags:
            self._drop_depth += 1
            return
        if self._drop_depth > 0 or tag not in self.allowed_tags:
            return

        cleaned_attrs = self._clean_attrs(tag, attrs)
        if tag == "a" and any(name == "href" for name, _ in cleaned_attrs):
            if not any(name == "target" for name, _ in cleaned_attrs):
                cleaned_attrs.append(("target", "_blank"))
            cleaned_attrs = [(name, value) for name, value in cleaned_attrs if name != "rel"]
            cleaned_attrs.append(("rel", "noopener noreferrer"))

        html = f"<{tag}{self._attrs_html(cleaned_attrs)}>"
        if tag in self.void_tags:
            html = f"<{tag}{self._attrs_html(cleaned_attrs)} />"
        self._destination().append(html)

    def handle_startendtag(self, tag: str, attrs):
        tag = (tag or "").lower()
        if tag in {"meta", "link"}:
            self.handle_starttag(tag, attrs)
            return
        if tag in self.drop_content_tags or tag == "style":
            return
        if self._drop_depth > 0 or tag not in self.allowed_tags:
            return
        cleaned_attrs = self._clean_attrs(tag, attrs)
        self._destination().append(f"<{tag}{self._attrs_html(cleaned_attrs)} />")

    def handle_endtag(self, tag: str):
        tag = (tag or "").lower()
        if tag == "html":
            return
        if tag == "head":
            self._in_head = False
            return
        if tag == "body":
            self._in_body = False
            return
        if tag == "style":
            if self._style_depth > 0:
                self._style_depth -= 1
                css = sanitize_css("".join(self._style_chunks))
                self._style_chunks = []
                if css.strip():
                    self.head_parts.append(f"<style>{css}</style>")
            return
        if tag in self.drop_content_tags:
            if self._drop_depth > 0:
                self._drop_depth -= 1
            return
        if self._drop_depth > 0 or tag not in self.allowed_tags or tag in self.void_tags:
            return
        self._destination().append(f"</{tag}>")

    def handle_data(self, data: str):
        if self._style_depth > 0:
            self._style_chunks.append(data)
            return
        if self._drop_depth == 0 and data:
            self._destination().append(escape(data))

    def get_preview_document(self) -> str:
        body = "".join(self.body_parts).strip() or "<p>No previewable HTML content found.</p>"
        head = "".join(self.head_parts)
        html_attrs = self._attrs_html(self.html_attrs)
        body_attrs = self._attrs_html(self.body_attrs)
        return (
            "<!DOCTYPE html>"
            f"<html{html_attrs}><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<style>"
            "html,body{margin:0;}"
            "img,svg,video{max-width:100%;height:auto;}"
            "</style>"
            f"{head}"
            f"</head><body{body_attrs}>{body}</body></html>"
        )


def sanitize_html_for_preview(content: bytes) -> str:
    """Return sanitized HTML that keeps author CSS and layout markup."""
    sanitizer = SafeHTMLPreviewSanitizer()
    sanitizer.feed(decode_text_content(content))
    sanitizer.close()
    return sanitizer.get_preview_document()


def render_document_preview_html(category: str, file_name: str, content: bytes) -> str:
    """Build an in-app HTML preview for Office files."""
    category = (category or "").upper()
    extension = _file_extension(file_name)
    is_zip = content.startswith(b"PK")
    if category == "PPT":
        if extension == ".ppt" and not is_zip:
            return render_ppt_preview_html(content, file_name)
        return render_pptx_preview_html(content, file_name)
    if category == "XLS":
        if extension == ".xls" and not is_zip:
            return render_xls_preview_html(content, file_name)
        return render_xlsx_preview_html(content, file_name)
    raise ValueError(f"No HTML converter for category {category}")


@dataclass(frozen=True)
class OfficePreviewResult:
    content: bytes
    media_type: str


def render_office_document_preview(category: str, file_name: str, content: bytes) -> OfficePreviewResult:
    """Convert PPT/XLS files for in-app preview using python-pptx / openpyxl HTML."""
    html = render_document_preview_html(category, file_name, content)
    return OfficePreviewResult(content=html.encode("utf-8"), media_type="text/html; charset=utf-8")


def _file_extension(file_name: str) -> str:
    name = (file_name or "").lower()
    for extension in (".pptx", ".ppt", ".xlsx", ".xls", ".html", ".htm"):
        if name.endswith(extension):
            return extension
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def _preview_shell(title: str, body: str, extra_css: str = "") -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{escape(title)}</title><style>"
        "html,body{margin:0;background:#e5e7eb;color:#111827;"
        "font-family:'Segoe UI',Tahoma,sans-serif;}"
        ".preview-wrap{padding:16px 16px 32px;}"
        ".preview-kicker{margin:0 0 12px;font-size:12px;color:#4b5563;}"
        f"{extra_css}"
        "</style></head><body><div class=\"preview-wrap\">"
        f"<p class=\"preview-kicker\">{escape(title)}</p>"
        f"{body}</div></body></html>"
    )


def _css_color(color) -> str | None:
    try:
        rgb = getattr(color, "rgb", None)
        if rgb is None:
            return None
        return f"#{str(rgb)}"
    except Exception:
        return None


def _pct(emu: int | None, total: int) -> float:
    if not total:
        return 0.0
    return round(100.0 * int(emu or 0) / int(total), 4)


_SCHEME_COLORS = {
    "dk1": "#000000",
    "lt1": "#ffffff",
    "dk2": "#1f4e79",
    "lt2": "#e7e6e6",
    "accent1": "#ed7d31",
    "accent2": "#4472c4",
    "accent3": "#70ad47",
    "accent4": "#ffc000",
    "accent5": "#5b9bd5",
    "accent6": "#7030a0",
    "hlink": "#0563c1",
    "folhlink": "#954f72",
    "tx1": "#000000",
    "tx2": "#1f4e79",
    "bg1": "#ffffff",
    "bg2": "#e7e6e6",
}


def _xml_color(element) -> str | None:
    if element is None:
        return None
    for node in element.iter():
        tag = getattr(node, "tag", "") or ""
        if tag.endswith("}srgbClr"):
            value = (node.get("val") or "").strip()
            if len(value) == 6:
                return f"#{value}"
        if tag.endswith("}schemeClr"):
            return _SCHEME_COLORS.get((node.get("val") or "").lower())
        if tag.endswith("}sysClr") and node.get("lastClr"):
            value = node.get("lastClr") or ""
            if len(value) == 6:
                return f"#{value}"
    return None


def _shape_fill_css(shape) -> str:
    try:
        color = _css_color(getattr(shape.fill, "fore_color", None))
        if color:
            return f"background:{color};"
    except Exception:
        pass
    try:
        sp_pr = None
        for child in shape._element:
            tag = getattr(child, "tag", "") or ""
            if tag.endswith("}spPr"):
                sp_pr = child
                break
        if sp_pr is None:
            return ""
        for child in sp_pr:
            tag = getattr(child, "tag", "") or ""
            if tag.endswith("}noFill"):
                return ""
            if tag.endswith("}solidFill"):
                color = _xml_color(child)
                if color:
                    return f"background:{color};"
    except Exception:
        return ""
    return ""


def _shape_is_hidden(shape) -> bool:
    try:
        for node in shape._element.iter():
            tag = getattr(node, "tag", "") or ""
            if tag.endswith("}cNvPr") and (node.get("hidden") or "").lower() in {"1", "true"}:
                return True
    except Exception:
        return False
    return False


def _shape_plain_text(shape) -> str:
    try:
        if getattr(shape, "has_text_frame", False):
            return re.sub(r"\s+", " ", shape.text_frame.text or "").strip()
    except Exception:
        return ""
    return ""


def _iter_group_shapes(shapes, dx: int = 0, dy: int = 0):
    for shape in shapes:
        try:
            shape_type = int(shape.shape_type)
        except Exception:
            shape_type = None
        left = int(getattr(shape, "left", 0) or 0)
        top = int(getattr(shape, "top", 0) or 0)
        if shape_type == 6:  # GROUP
            inner = getattr(shape, "shapes", None)
            if inner is not None:
                yield from _iter_group_shapes(inner, dx + left, dy + top)
            continue
        yield shape, dx, dy


def _vertical_align_css(shape) -> str:
    try:
        for node in shape.text_frame._txBody.iter():
            tag = getattr(node, "tag", "") or ""
            if tag.endswith("}bodyPr"):
                anchor = (node.get("anchor") or "t").lower()
                return {"t": "flex-start", "ctr": "center", "b": "flex-end"}.get(anchor, "flex-start")
    except Exception:
        return "flex-start"
    return "flex-start"


def _font_size_pt(run, paragraph) -> float:
    for font in (getattr(run, "font", None), getattr(paragraph, "font", None)):
        try:
            size = getattr(font, "size", None)
            if size:
                return float(size.pt)
        except Exception:
            continue
    return 16.0


def _run_color(run) -> str | None:
    try:
        return _css_color(run.font.color) or _xml_color(run._r)
    except Exception:
        return _xml_color(getattr(run, "_r", None))


def _render_text_frame(shape, slide_height_emu: int, shape_height_pct: float = 100.0) -> str:
    if not getattr(shape, "has_text_frame", False):
        return ""
    paragraphs = []
    try:
        from pptx.enum.text import PP_ALIGN
    except Exception:
        PP_ALIGN = None

    slide_pt = max(1.0, int(slide_height_emu) / 12700.0)
    # Cap font so text cannot explode out of its box and stack on neighbors.
    max_cqh = max(2.0, min(28.0, float(shape_height_pct) * 0.85))

    for paragraph in shape.text_frame.paragraphs:
        spans = []
        align = "left"
        try:
            if PP_ALIGN is not None and paragraph.alignment == PP_ALIGN.CENTER:
                align = "center"
            elif PP_ALIGN is not None and paragraph.alignment == PP_ALIGN.RIGHT:
                align = "right"
        except Exception:
            pass
        for run in paragraph.runs:
            text = run.text or ""
            if not text:
                continue
            style = ["white-space:pre-wrap", "line-height:1.2", "display:inline"]
            try:
                if run.font.bold:
                    style.append("font-weight:700")
                if run.font.italic:
                    style.append("font-style:italic")
                pt = _font_size_pt(run, paragraph)
                cqh = min(max_cqh, (pt / slide_pt) * 100.0)
                style.append(f"font-size:{cqh:.2f}cqh")
                color = _run_color(run)
                if color:
                    style.append(f"color:{color}")
            except Exception:
                pass
            spans.append(f'<span style="{";".join(style)}">{escape(text)}</span>')
        if not spans and (paragraph.text or "").strip():
            spans.append(escape(paragraph.text))
        if spans:
            paragraphs.append(f'<div style="text-align:{align};width:100%;">{"".join(spans)}</div>')
    if not paragraphs:
        return ""
    justify = _vertical_align_css(shape)
    return (
        f'<div style="display:flex;flex-direction:column;justify-content:{justify};'
        'padding:2% 3%;width:100%;height:100%;overflow:hidden;box-sizing:border-box;">'
        f"{''.join(paragraphs)}</div>"
    )


def _image_html(blob: bytes, ext: str, cover: bool = False) -> str:
    if not blob or len(blob) > MAX_EMBEDDED_IMAGE_BYTES:
        return ""
    ext = (ext or "png").lower().lstrip(".")
    mime = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
        "tif": "image/tiff",
        "tiff": "image/tiff",
    }.get(ext, "image/png")
    encoded = base64.b64encode(blob).decode("ascii")
    fit = "cover" if cover else "contain"
    return (
        f'<img alt="" src="data:{mime};base64,{encoded}" '
        f'style="width:100%;height:100%;object-fit:{fit};display:block;" />'
    )


def _blip_image_html(shape, cover: bool = False) -> str:
    try:
        blip = None
        for node in shape._element.iter():
            tag = getattr(node, "tag", "") or ""
            if tag.endswith("}blip"):
                blip = node
                break
        if blip is None:
            return ""
        embed = blip.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
        )
        if not embed:
            return ""
        part = shape.part.related_part(embed)
        blob = getattr(part, "blob", None)
        if not blob:
            return ""
        content_type = (getattr(part, "content_type", "") or "").lower()
        ext = content_type.split("/")[-1] if "/" in content_type else "png"
        return _image_html(blob, ext, cover)
    except Exception:
        return ""


def _render_picture(shape, cover: bool = False) -> str:
    try:
        image = shape.image
        html = _image_html(image.blob, image.ext or "png", cover)
        if html:
            return html
    except Exception:
        pass
    return _blip_image_html(shape, cover)


def _render_table(shape) -> str:
    try:
        table = shape.table
    except Exception:
        return ""
    rows_html = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            cells.append(
                "<td style=\"border:1px solid rgba(0,0,0,.12);padding:6px 8px;vertical-align:top;"
                f"background:rgba(255,255,255,.92);\">{escape(cell.text or '')}</td>"
            )
        rows_html.append(f"<tr>{''.join(cells)}</tr>")
    return (
        "<table style=\"width:100%;height:100%;border-collapse:collapse;table-layout:fixed;\">"
        f"{''.join(rows_html)}</table>"
    )


def _pptx_shape_layer(index: int, has_image: bool, width: float, height: float, has_fill: bool) -> int:
    if has_image and width >= 70 and height >= 50:
        return 1
    if has_image:
        return 4
    if has_fill:
        return 8 + index
    return 20 + index


def _rect_intersect_area(first: dict, second: dict) -> float:
    x1 = max(float(first["left"]), float(second["left"]))
    y1 = max(float(first["top"]), float(second["top"]))
    x2 = min(float(first["left"]) + float(first["width"]), float(second["left"]) + float(second["width"]))
    y2 = min(float(first["top"]) + float(first["height"]), float(second["top"]) + float(second["height"]))
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _drop_duplicate_text_shapes(drawn: list[dict]) -> list[dict]:
    """Keep the tighter filled box when the same wording appears twice."""
    keep = [True] * len(drawn)
    for i, first in enumerate(drawn):
        if not keep[i] or first.get("has_image"):
            continue
        text_a = (first.get("text") or "").strip()
        if len(text_a) < 3:
            continue
        for j, second in enumerate(drawn):
            if i == j or not keep[j] or second.get("has_image"):
                continue
            text_b = (second.get("text") or "").strip()
            if len(text_b) < 3:
                continue
            if text_a not in text_b and text_b not in text_a:
                continue
            overlap = _rect_intersect_area(first, second)
            area_a = max(float(first["area"]), 0.01)
            area_b = max(float(second["area"]), 0.01)
            if overlap / min(area_a, area_b) < 0.2 and text_a != text_b:
                continue
            # Prefer filled / smaller / later (higher z) content box.
            drop_i = False
            if first.get("has_fill") and not second.get("has_fill"):
                drop_i = False
            elif second.get("has_fill") and not first.get("has_fill"):
                drop_i = True
            elif area_b < area_a:
                drop_i = True
            elif area_a < area_b:
                drop_i = False
            else:
                drop_i = i < j
            if drop_i:
                keep[i] = False
                break
            keep[j] = False
    return [item for item, flag in zip(drawn, keep) if flag]


def _drop_text_overlapping_images(drawn: list[dict]) -> list[dict]:
    """Hide unfilled leftover text that sits on logos / small pictures."""
    images = [item for item in drawn if item.get("has_image")]
    if not images:
        return drawn
    kept: list[dict] = []
    for item in drawn:
        if item.get("has_image") or item.get("has_fill"):
            kept.append(item)
            continue
        text = (item.get("text") or "").strip()
        if not text:
            kept.append(item)
            continue
        text_area = max(float(item["area"]), 0.01)
        for image in images:
            overlap = _rect_intersect_area(item, image) / text_area
            image_area = float(image.get("area") or 0)
            # Logo / brand mark: drop covering text.
            if image_area < 900 and overlap >= 0.35:
                break
            # Hero photo top-left brand leftovers.
            if image_area >= 900 and overlap >= 0.25 and float(item["left"]) < 40 and float(item["top"]) < 35:
                break
        else:
            kept.append(item)
    return kept


def _drop_overlapping_unfilled_text(drawn: list[dict]) -> list[dict]:
    """When two unfilled text boxes heavily overlap, keep the smaller one."""
    keep = [True] * len(drawn)
    for i, first in enumerate(drawn):
        if not keep[i] or first.get("has_image") or first.get("has_fill"):
            continue
        if not (first.get("text") or "").strip():
            continue
        area_a = max(float(first["area"]), 0.01)
        for j, second in enumerate(drawn):
            if j <= i or not keep[j] or second.get("has_image") or second.get("has_fill"):
                continue
            if not (second.get("text") or "").strip():
                continue
            area_b = max(float(second["area"]), 0.01)
            overlap = _rect_intersect_area(first, second)
            if overlap / min(area_a, area_b) < 0.45:
                continue
            if area_a >= area_b:
                keep[i] = False
                break
            keep[j] = False
    return [item for item, flag in zip(drawn, keep) if flag]


def render_pptx_preview_html(content: bytes, file_name: str) -> str:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    presentation = Presentation(io.BytesIO(content))
    slide_width = int(presentation.slide_width or 1)
    slide_height = int(presentation.slide_height or 1)
    ratio = f"{slide_width} / {slide_height}"
    slides_html: list[str] = []

    for index, slide in enumerate(presentation.slides, start=1):
        if index > MAX_PRESENTATION_SLIDES:
            break
        try:
            background = "#ffffff"
            try:
                color = _css_color(slide.background.fill.fore_color) or _xml_color(slide.background._element)
                if color:
                    background = color
            except Exception:
                pass

            drawn: list[dict] = []
            for shape_index, (shape, dx, dy) in enumerate(_iter_group_shapes(slide.shapes)):
                if _shape_is_hidden(shape):
                    continue
                try:
                    left_emu = int(getattr(shape, "left", 0) or 0) + dx
                    top_emu = int(getattr(shape, "top", 0) or 0) + dy
                    width_emu = int(getattr(shape, "width", 0) or 0)
                    height_emu = int(getattr(shape, "height", 0) or 0)
                except Exception:
                    continue
                if width_emu <= 0 or height_emu <= 0:
                    continue
                if left_emu + width_emu <= 0 or top_emu + height_emu <= 0:
                    continue
                if left_emu >= slide_width or top_emu >= slide_height:
                    continue

                left = _pct(left_emu, slide_width)
                top = _pct(top_emu, slide_height)
                width = max(0.35, _pct(width_emu, slide_width))
                height = max(0.35, _pct(height_emu, slide_height))
                cover_image = width >= 92 and height >= 88
                fill_css = _shape_fill_css(shape)
                inner = ""
                has_image = False
                text = _shape_plain_text(shape)
                try:
                    shape_type = getattr(shape, "shape_type", None)
                    is_picture = shape_type == MSO_SHAPE_TYPE.PICTURE
                    if getattr(shape, "has_table", False):
                        inner = _render_table(shape)
                    elif is_picture:
                        # Pictures only — never paint leftover text on the bitmap.
                        inner = _render_picture(shape, cover=cover_image)
                        has_image = bool(inner)
                    else:
                        picture = _render_picture(shape, cover=False)
                        text_html = _render_text_frame(shape, slide_height, height)
                        inner = f"{picture}{text_html}"
                        has_image = bool(picture)
                except Exception:
                    inner = _render_text_frame(shape, slide_height, height)

                # Skip empty placeholders that only create stacked ghost text.
                try:
                    if getattr(shape, "is_placeholder", False) and not text and not has_image and not fill_css:
                        continue
                except Exception:
                    pass
                if not inner and text:
                    inner = (
                        '<div style="padding:3%;width:100%;height:100%;box-sizing:border-box;'
                        f'overflow:hidden;">{escape(text)}</div>'
                    )
                if not inner and not fill_css:
                    continue

                layer = _pptx_shape_layer(shape_index, has_image, width, height, bool(fill_css))
                drawn.append(
                    {
                        "html": (
                            f'<div class="pptx-shape" style="left:{left}%;top:{top}%;width:{width}%;'
                            f'height:{height}%;z-index:{layer};{fill_css}">{inner}</div>'
                        ),
                        "text": (text or "").lower(),
                        "has_fill": bool(fill_css),
                        "has_image": has_image,
                        "area": width * height,
                        "left": left,
                        "top": top,
                        "width": width,
                        "height": height,
                    }
                )

            drawn = _drop_text_overlapping_images(drawn)
            drawn = _drop_overlapping_unfilled_text(drawn)
            drawn = _drop_duplicate_text_shapes(drawn)
            parts = [item["html"] for item in drawn]
            if not parts:
                parts.append('<div class="pptx-empty">This slide has no previewable shapes.</div>')
            slides_html.append(
                f'<section class="pptx-slide" style="aspect-ratio:{ratio};background:{background};">'
                f"{''.join(parts)}</section>"
            )
        except Exception as exc:
            logger.warning("Failed to render PPTX slide %s for %s: %s", index, file_name, exc)
            slides_html.append(
                f'<section class="pptx-slide" style="aspect-ratio:{ratio};background:#fff;">'
                f'<div class="pptx-empty">Slide {index} could not be rendered.</div></section>'
            )

    if not slides_html:
        slides_html.append('<section class="pptx-slide"><p>No slides found.</p></section>')

    extra_css = (
        ".pptx-slide{position:relative;width:min(100%,1080px);margin:0 auto 20px;overflow:hidden;"
        "border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.16);container-type:size;background:#fff;}"
        ".pptx-shape{position:absolute;overflow:hidden;box-sizing:border-box;}"
        ".pptx-shape img{pointer-events:none;}"
        ".pptx-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"
        "color:#6b7280;font-size:16px;}"
        ".preview-kicker{display:none;}"
    )
    title = f"Presentation preview · {file_name}"
    if len(presentation.slides) > MAX_PRESENTATION_SLIDES:
        title += f" (first {MAX_PRESENTATION_SLIDES} slides)"
    return _preview_shell(title, "".join(slides_html), extra_css)


def _extract_ppt_slide_texts(content: bytes) -> list[list[str]]:
    import olefile

    with olefile.OleFileIO(io.BytesIO(content)) as ole:
        stream_name = None
        for candidate in ("PowerPoint Document", "Contents"):
            if ole.exists(candidate):
                stream_name = candidate
                break
        if stream_name is None:
            raise ValueError("PowerPoint Document stream not found")
        data = ole.openstream(stream_name).read()

    slides: list[list[str]] = []
    current: list[str] = []

    def flush():
        nonlocal current
        texts = [item.strip() for item in current if item and item.strip()]
        if texts:
            slides.append(texts)
        current = []

    def parse(start: int, end: int):
        offset = start
        while offset + 8 <= end:
            rec_info, rec_type, rec_len = struct.unpack_from("<HHI", data, offset)
            offset += 8
            rec_end = min(offset + rec_len, end)
            rec_ver = rec_info & 0xF
            if rec_type in {0x03EE, 0x03F0}:
                flush()
            if rec_ver == 0xF:
                parse(offset, rec_end)
            elif rec_type == 0x0FA0:
                current.append(data[offset:rec_end].decode("utf-16-le", errors="ignore"))
            elif rec_type == 0x0FA8:
                current.append(data[offset:rec_end].decode("latin-1", errors="ignore"))
            offset = rec_end

    parse(0, len(data))
    flush()
    return slides


def render_ppt_preview_html(content: bytes, file_name: str) -> str:
    try:
        slides = _extract_ppt_slide_texts(content)
    except Exception as exc:
        logger.warning("Failed to parse .ppt records for %s: %s", file_name, exc)
        slides = []

    if not slides:
        raise ValueError("Could not extract slides from this .ppt file")

    cards = []
    for index, texts in enumerate(slides[:MAX_PRESENTATION_SLIDES], start=1):
        cards.append(
            f'<section class="ppt-slide"><div class="pptx-label">Slide {index}</div>'
            + "".join(
                f"<h2>{escape(text)}</h2>" if i == 0 else f"<p>{escape(text)}</p>"
                for i, text in enumerate(texts)
                if text
            )
            + "</section>"
        )
    extra_css = (
        ".ppt-slide{position:relative;max-width:960px;margin:0 auto 16px;background:#fff;"
        "border-radius:12px;padding:28px 32px 24px;box-shadow:0 10px 30px rgba(15,23,42,.12);"
        "min-height:180px;}"
        ".ppt-slide h2{margin:0 0 12px;font-size:28px;line-height:1.25;}"
        ".ppt-slide p{margin:0 0 10px;font-size:18px;line-height:1.45;white-space:pre-wrap;}"
        ".pptx-label{position:absolute;top:8px;right:8px;background:rgba(15,23,42,.72);"
        "color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;}"
    )
    title = f"Presentation preview · {file_name}"
    return _preview_shell(title, "".join(cards), extra_css)


def _format_cell_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime):
        if value.time() == time.min:
            return value.strftime("%Y-%m-%d")
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.10g}"
    return str(value)


def _spreadsheet_col_min_width(text: str) -> int:
    """Estimate a readable min-width in px from cell text length."""
    raw = text or ""
    # Prefer longest line when cells contain newlines.
    longest = max((len(line) for line in raw.splitlines()), default=0) if raw else 0
    if longest <= 0:
        return 72
    # ~8px per character, with room for padding; clamp for readability.
    return max(88, min(520, 24 + longest * 8))


def _spreadsheet_table(headers: list[str] | None, rows: list[list[str]], truncated: bool) -> str:
    col_count = max(len(headers or []), max((len(row) for row in rows), default=0))
    if col_count <= 0:
        return '<p class="sheet-note">This sheet is empty.</p>'

    # Size each column from the widest value so long text is not clipped.
    col_widths = [72] * col_count
    for source in ([headers] if headers else []) + rows:
        for col_index, value in enumerate(list(source)[:col_count]):
            col_widths[col_index] = max(col_widths[col_index], _spreadsheet_col_min_width(value))

    colgroup = "".join(
        f'<col style="min-width:{width}px;width:{width}px;" />' for width in col_widths
    )
    head_cells = "".join(
        f'<th style="min-width:{col_widths[i]}px;">{escape(item)}</th>'
        for i, item in enumerate((headers or [""] * col_count)[:col_count])
    )
    head_html = (
        f"<thead><tr><th class=\"row-num\"></th>{head_cells}</tr></thead>"
        if headers is not None
        else ""
    )
    body_rows = []
    start_index = 2 if headers is not None else 1
    # When first row was promoted to headers, still show spreadsheet row numbers starting at 1 for headers row visually as sticky.
    for index, row in enumerate(rows, start=start_index):
        padded = list(row) + [""] * max(0, col_count - len(row))
        cells = "".join(
            f'<td style="min-width:{col_widths[i]}px;">{escape(padded[i])}</td>'
            for i in range(col_count)
        )
        body_rows.append(f'<tr><th class="row-num">{index}</th>{cells}</tr>')
    note = '<p class="sheet-note">Preview shows a limited range of this sheet.</p>' if truncated else ""
    return (
        f'<div class="sheet-scroll"><table><colgroup><col class="row-num-col" />{colgroup}</colgroup>'
        f"{head_html}<tbody>{''.join(body_rows)}</tbody></table></div>{note}"
    )


def _spreadsheet_shell(file_name: str, sheets_html: str) -> str:
    extra_css = (
        "html,body{height:100%;background:#fff !important;}"
        ".preview-wrap{padding:0 !important;min-height:100%;height:100%;box-sizing:border-box;}"
        ".preview-kicker{display:none;}"
        ".sheet-block{max-width:100%;margin:0;background:#fff;border-radius:0;"
        "box-shadow:none;overflow:hidden;display:flex;flex-direction:column;height:100%;min-height:100%;}"
        ".sheet-title{margin:0;padding:10px 14px;background:#111827;color:#fff;font-size:13px;flex:0 0 auto;}"
        ".sheet-scroll{overflow:auto;flex:1 1 auto;min-height:0;}"
        "table{border-collapse:collapse;min-width:100%;font-size:12px;table-layout:auto;}"
        "col.row-num-col{width:44px;min-width:44px;}"
        "th,td{border:1px solid #e5e7eb;padding:8px 12px;vertical-align:top;"
        "white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;"
        "line-height:1.45;}"
        "th{background:#f3f4f6;position:sticky;top:0;z-index:1;text-align:left;font-weight:600;}"
        "th.row-num{width:44px;min-width:44px;max-width:44px;text-align:center;color:#6b7280;"
        "background:#f8fafc;position:sticky;left:0;z-index:2;white-space:nowrap;"
        "overflow:hidden;padding:8px 4px;}"
        "tr:nth-child(even) td{background:#f9fafb;}"
        ".sheet-note{margin:0;padding:8px 16px 12px;color:#6b7280;font-size:12px;}"
    )
    return _preview_shell(f"Spreadsheet preview · {file_name}", sheets_html, extra_css)


def render_xlsx_preview_html(content: bytes, file_name: str) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    blocks: list[str] = []
    try:
        for sheet_index, worksheet in enumerate(workbook.worksheets):
            if sheet_index >= MAX_SPREADSHEET_SHEETS:
                break
            rows: list[list[str]] = []
            truncated = False
            for row_index, row in enumerate(worksheet.iter_rows(values_only=True)):
                if row_index >= MAX_SPREADSHEET_ROWS:
                    truncated = True
                    break
                values = [_format_cell_value(value) for value in list(row)[:MAX_SPREADSHEET_COLS]]
                if any(item != "" for item in values):
                    rows.append(values)
            if not rows:
                table = '<p class="sheet-note">This sheet is empty.</p>'
            else:
                # Keep every worksheet row as data so title / tip cells are not clipped into a header.
                table = _spreadsheet_table(None, rows, truncated)
            blocks.append(
                f'<section class="sheet-block"><h2 class="sheet-title">{escape(worksheet.title)}</h2>{table}</section>'
            )
    finally:
        workbook.close()

    if not blocks:
        blocks.append('<section class="sheet-block"><p class="sheet-note">No worksheets found.</p></section>')
    return _spreadsheet_shell(file_name, "".join(blocks))


def render_xls_preview_html(content: bytes, file_name: str) -> str:
    import xlrd

    workbook = xlrd.open_workbook(file_contents=content)
    blocks: list[str] = []
    datemode = workbook.datemode
    for sheet_index in range(min(workbook.nsheets, MAX_SPREADSHEET_SHEETS)):
        sheet = workbook.sheet_by_index(sheet_index)
        rows: list[list[str]] = []
        truncated = sheet.nrows > MAX_SPREADSHEET_ROWS
        max_rows = min(sheet.nrows, MAX_SPREADSHEET_ROWS)
        max_cols = min(sheet.ncols, MAX_SPREADSHEET_COLS)
        for row_index in range(max_rows):
            values = []
            for col_index in range(max_cols):
                cell = sheet.cell(row_index, col_index)
                value = cell.value
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        value = datetime(*xlrd.xldate_as_tuple(cell.value, datemode))
                    except Exception:
                        pass
                values.append(_format_cell_value(value))
            if any(item != "" for item in values):
                rows.append(values)
        table = (
            _spreadsheet_table(None, rows, truncated)
            if rows
            else '<p class="sheet-note">This sheet is empty.</p>'
        )
        blocks.append(
            f'<section class="sheet-block"><h2 class="sheet-title">{escape(sheet.name)}</h2>{table}</section>'
        )
    if not blocks:
        blocks.append('<section class="sheet-block"><p class="sheet-note">No worksheets found.</p></section>')
    return _spreadsheet_shell(file_name, "".join(blocks))
