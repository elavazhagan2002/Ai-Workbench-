
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Domain, UseCase

router = APIRouter()

class DomainSummary(BaseModel):
    domain_id: str
    domain_name: str
    use_cases_count: int
    demo_count: int

class AppSummary(BaseModel):
    domains_count: int
    use_cases_count: int
    demo_use_cases_count: int
    status_counts: dict[str, int]
    domain_summaries: list[DomainSummary]

class FeaturedUseCase(BaseModel):
    use_case_id: str
    use_case_name: str
    use_case_title: str | None = None
    status: str
    has_demo: bool
    domain_name: str

@router.get("/app-summary", response_model=AppSummary)
async def get_app_summary(db: Session = Depends(get_db)):
    # Total counts
    domains_count = db.query(Domain).count()
    use_cases_count = db.query(UseCase).count()
    demo_use_cases_count = db.query(func.count(UseCase.use_case_id)).filter(
        UseCase.demo_video_path.isnot(None)
    ).scalar() or 0

    # Status counts - always complete dict with all 9 statuses
    status_result = db.query(UseCase.status, func.count(UseCase.use_case_id))\
                      .group_by(UseCase.status).all()
    status_counts = {s: c for s, c in status_result}
    all_statuses = ["New", "Analysis", "Review", "Approved", "Rejected",
                    "Development", "Testing", "Production", "Retired"]
    for s in all_statuses:
        status_counts.setdefault(s, 0)

    # Domain summaries w/ conditional demo count
    domain_summaries = db.query(
        Domain.domain_id,
        Domain.domain_name,
        func.count(UseCase.use_case_id).label('use_cases_count'),
        func.sum(case((UseCase.demo_video_path.isnot(None), 1), else_=0)).label('demo_count')
    ).outerjoin(UseCase, Domain.domain_id == UseCase.domain_id)\
     .group_by(Domain.domain_id, Domain.domain_name)\
     .order_by(Domain.domain_name.asc()).all()

    summaries = [
        DomainSummary(
            domain_id=d[0],
            domain_name=d[1],
            use_cases_count=d[2] or 0,
            demo_count=d[3] or 0
        ) for d in domain_summaries
    ]

    return AppSummary(
        domains_count=domains_count,
        use_cases_count=use_cases_count,
        demo_use_cases_count=demo_use_cases_count,
        status_counts=status_counts,
        domain_summaries=summaries
    )

@router.get("/featured-use-cases", response_model=list[FeaturedUseCase])
async def get_featured_use_cases(db: Session = Depends(get_db)):
    # Showcase priority: demo+Production > demo+Approved > demo+Development > newest
    featured = db.query(
        UseCase.use_case_id,
        UseCase.use_case_name,
        UseCase.use_case_title,
        UseCase.status,
        case((UseCase.demo_video_path.isnot(None), True), else_=False).label('has_demo'),
        Domain.domain_name
    ).join(Domain).filter(
        UseCase.status.in_(['Production', 'Approved', 'Development'])
    ).order_by(
        case((UseCase.demo_video_path.isnot(None), 1), else_=0).desc(),  # demo first
        case(
            (UseCase.status == 'Production', 3),
            (UseCase.status == 'Approved', 2),
            (UseCase.status == 'Development', 1),
            else_=0
        ).desc(),  # status priority
        UseCase.created_dt.desc()  # newest tiebreaker
    ).limit(6).all()

    return [
        FeaturedUseCase(
            use_case_id=f[0],
            use_case_name=f[1],
            use_case_title=f[2],
            status=f[3],
            has_demo=f[4],
            domain_name=f[5]
        ) for f in featured
    ]

