"""Document type lookup helpers for use-case attachments."""
import uuid

from sqlalchemy.orm import Session

DEFAULT_DOCUMENT_TYPES: tuple[tuple[str, str], ...] = (
    ("Architecture diagram", "Solution architecture, sequence, or component diagrams"),
    ("Solution design", "Design documents and technical approach write-ups"),
    ("Technical specification", "Detailed technical specs or requirements"),
    ("Data flow", "Data lineage, flow, or integration maps"),
    ("Interface specification", "API, interface, or contract documents"),
    ("Security assessment", "Security, privacy, or threat model artifacts"),
    ("Other", "Supporting documents that do not fit another type"),
)

DOCUMENT_SOURCES = frozenset({"reference", "technical_analysis"})
DEFAULT_DOCUMENT_SOURCE = "reference"


def seed_default_document_types(db: Session) -> None:
    """Insert starter lookup values when the table is empty."""
    from app.models import DocumentType

    if db.query(DocumentType).first():
        return
    for name, description in DEFAULT_DOCUMENT_TYPES:
        db.add(
            DocumentType(
                doc_type_id=str(uuid.uuid4()),
                name=name,
                description=description,
            )
        )
    db.commit()


def list_document_types(db: Session):
    from app.models import DocumentType

    seed_default_document_types(db)
    return db.query(DocumentType).order_by(DocumentType.name).all()


def resolve_document_type_name(db: Session, document_type: str | None) -> str | None:
    """Return the canonical lookup name, or None when blank."""
    from app.models import DocumentType

    name = (document_type or "").strip()
    if not name:
        return None
    match = (
        db.query(DocumentType)
        .filter(DocumentType.name == name)
        .first()
    )
    return match.name if match else None


def normalize_document_source(source: str | None) -> str:
    value = (source or "").strip()
    if not value:
        return DEFAULT_DOCUMENT_SOURCE
    if value not in DOCUMENT_SOURCES:
        return DEFAULT_DOCUMENT_SOURCE
    return value


def is_technical_analysis_source(source: str | None) -> bool:
    return (source or "").strip() == "technical_analysis"
