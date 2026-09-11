"""
Blog and article posts: metadata in DB, files under FILE_STORAGE_ROOT/blog_content.
"""
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, field_serializer
from sqlalchemy.orm import Session

from app.core.authorization import get_user_with_permissions, require_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.logging_config import logger
from app.middleware.auth_middleware import get_current_user_id
from app.models import AuditLog, BlogPost, User

router = APIRouter()

MAX_BLOG_FILE_BYTES = 30 * 1024 * 1024  # 30 MB
ALLOWED_KINDS = frozenset({"blog", "article"})
ALLOWED_FORMATS = frozenset({"pdf", "html"})


class BlogPostResponse(BaseModel):
    blog_post_id: str
    title: str
    kind: str
    content_format: str
    published: bool
    published_at: datetime | None
    summary: str | None
    created_by: str | None
    created_dt: datetime
    modified_dt: datetime

    @field_serializer("published_at", "created_dt", "modified_dt")
    def serialize_dt(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.isoformat()

    class Config:
        from_attributes = True


class BlogPostUpdate(BaseModel):
    title: str | None = None
    published: bool | None = None


def _resolve_blog_file_path(post: BlogPost) -> Path:
    root = settings.get_blog_content_root().resolve()
    candidate = Path((post.stored_path or "").replace("\\", "/"))
    full = (root / candidate).resolve()
    try:
        full.relative_to(root)
    except ValueError:
        logger.warning("Blog path escapes storage root: %s", full)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stored path")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content file not found")
    return full


def _detect_format(filename: str, content_type: str | None) -> str | None:
    lower = (filename or "").lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".html") or lower.endswith(".htm"):
        return "html"
    ct = (content_type or "").lower()
    if ct == "application/pdf":
        return "pdf"
    if ct in ("text/html", "application/xhtml+xml"):
        return "html"
    return None


def _can_view_post(user: User, db: Session, post: BlogPost, permissions: list[str], is_admin: bool) -> bool:
    if is_admin or "manage_blog" in permissions:
        return True
    if "view_blog" not in permissions:
        return False
    return bool(post.published)


@router.get("/", response_model=list[BlogPostResponse])
async def list_blog_posts(
    request: Request,
    db: Session = Depends(get_db),
    include_unpublished: bool = False,
):
    """List posts. Published only unless caller has manage_blog and include_unpublished=true."""
    user_id = get_current_user_id(request)
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "view_blog",
        allow_admin=True,
        error_message="You do not have permission to view blogs and articles",
    )
    q = db.query(BlogPost).order_by(BlogPost.created_dt.desc())
    if include_unpublished and (is_user_admin or "manage_blog" in permissions):
        posts = q.all()
    else:
        posts = (
            q.filter(BlogPost.published.is_(True))
            .order_by(BlogPost.published_at.desc().nulls_last(), BlogPost.created_dt.desc())
            .all()
        )
    return posts


@router.get("/{blog_post_id}", response_model=BlogPostResponse)
async def get_blog_post(blog_post_id: str, request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "view_blog",
        allow_admin=True,
        error_message="You do not have permission to view blogs and articles",
    )
    post = db.query(BlogPost).filter(BlogPost.blog_post_id == blog_post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if not _can_view_post(user, db, post, permissions, is_user_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This post is not published")
    return post


@router.get("/{blog_post_id}/content")
async def get_blog_content(blog_post_id: str, request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    user, permissions, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "view_blog",
        allow_admin=True,
        error_message="You do not have permission to view blogs and articles",
    )
    post = db.query(BlogPost).filter(BlogPost.blog_post_id == blog_post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if not _can_view_post(user, db, post, permissions, is_user_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This post is not published")
    path = _resolve_blog_file_path(post)
    media = "application/pdf" if post.content_format == "pdf" else "text/html; charset=utf-8"
    headers = {
        "Cache-Control": "private, max-age=3600",
    }
    if post.content_format == "html":
        headers["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; "
            "font-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        headers["X-Content-Type-Options"] = "nosniff"
    return FileResponse(path, media_type=media, filename=path.name, headers=headers)


@router.post("/", response_model=BlogPostResponse, status_code=status.HTTP_201_CREATED)
async def create_blog_post(
    request: Request,
    db: Session = Depends(get_db),
    title: str = Form(...),
    kind: str = Form(...),
    published: bool = Form(False),
    file: UploadFile = File(...),
):
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "manage_blog",
        allow_admin=True,
        error_message="Only administrators and architects can create blogs and articles",
    )
    kind_norm = (kind or "").strip().lower()
    if kind_norm not in ALLOWED_KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind must be 'blog' or 'article'")
    title_clean = (title or "").strip()
    if not title_clean or len(title_clean) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid title")

    fmt = _detect_format(file.filename or "", file.content_type)
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF or HTML uploads are allowed (.pdf, .html)",
        )

    raw = await file.read()
    if len(raw) > MAX_BLOG_FILE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 30 MB)")

    post = BlogPost(
        title=title_clean,
        kind=kind_norm,
        content_format=fmt,
        stored_path="",  # set after id known
        published=bool(published),
        published_at=datetime.utcnow() if published else None,
        created_by=user_id,
        modified_by=user_id,
    )
    db.add(post)
    db.flush()

    root = settings.get_blog_content_root()
    root.mkdir(parents=True, exist_ok=True)
    post_dir = root / post.blog_post_id
    post_dir.mkdir(parents=True, exist_ok=True)
    ext = ".pdf" if fmt == "pdf" else ".html"
    stored_name = f"content{ext}"
    dest = post_dir / stored_name
    dest.write_bytes(raw)
    post.stored_path = f"{post.blog_post_id}/{stored_name}"
    db.add(
        AuditLog(
            type="content",
            action="blog_post_created",
            user_id=user_id,
            details={"blog_post_id": post.blog_post_id, "kind": kind_norm, "format": fmt},
        )
    )
    db.commit()
    db.refresh(post)
    return post


@router.patch("/{blog_post_id}", response_model=BlogPostResponse)
async def update_blog_post(
    blog_post_id: str,
    body: BlogPostUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "manage_blog",
        allow_admin=True,
        error_message="Only administrators and architects can update blogs and articles",
    )
    post = db.query(BlogPost).filter(BlogPost.blog_post_id == blog_post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if body.title is not None:
        t = body.title.strip()
        if not t or len(t) > 200:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid title")
        post.title = t
    if body.published is not None:
        post.published = body.published
        if body.published and post.published_at is None:
            post.published_at = datetime.utcnow()
        if not body.published:
            post.published_at = None
    post.modified_by = user_id
    db.commit()
    db.refresh(post)
    return post


@router.post("/{blog_post_id}/replace-file", response_model=BlogPostResponse)
async def replace_blog_file(
    blog_post_id: str,
    request: Request,
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "manage_blog",
        allow_admin=True,
        error_message="Only administrators and architects can update blogs and articles",
    )
    post = db.query(BlogPost).filter(BlogPost.blog_post_id == blog_post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    fmt = _detect_format(file.filename or "", file.content_type)
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF or HTML uploads are allowed (.pdf, .html)",
        )
    raw = await file.read()
    if len(raw) > MAX_BLOG_FILE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 30 MB)")

    root = settings.get_blog_content_root()
    post_dir = root / post.blog_post_id
    post_dir.mkdir(parents=True, exist_ok=True)
    ext = ".pdf" if fmt == "pdf" else ".html"
    stored_name = f"content{ext}"
    dest = post_dir / stored_name
    dest.write_bytes(raw)
    post.stored_path = f"{post.blog_post_id}/{stored_name}"
    post.content_format = fmt
    post.modified_by = user_id
    db.commit()
    db.refresh(post)
    return post


@router.delete("/{blog_post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog_post(blog_post_id: str, request: Request, db: Session = Depends(get_db)):
    user_id = get_current_user_id(request)
    user, _, is_user_admin = get_user_with_permissions(db, user_id)
    require_permission(
        db,
        user,
        "manage_blog",
        allow_admin=True,
        error_message="Only administrators and architects can delete blogs and articles",
    )
    post = db.query(BlogPost).filter(BlogPost.blog_post_id == blog_post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    root = settings.get_blog_content_root()
    post_dir = root / post.blog_post_id
    if post_dir.is_dir():
        try:
            shutil.rmtree(post_dir, ignore_errors=True)
        except Exception as e:
            logger.warning("Could not remove blog dir %s: %s", post_dir, e)
    db.delete(post)
    db.add(
        AuditLog(
            type="content",
            action="blog_post_deleted",
            user_id=user_id,
            details={"blog_post_id": blog_post_id},
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
