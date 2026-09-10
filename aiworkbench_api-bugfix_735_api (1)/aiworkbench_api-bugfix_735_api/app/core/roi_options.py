"""
ROI-phase savings option lists and helpers.
"""
from __future__ import annotations

import uuid

from app.core.estimate_options import CURRENCY_OPTIONS, compute_estimate_totals

ROI_SAVING_CATEGORIES = [
    "Labor / FTE Savings",
    "Productivity Benefits",
    "Avoided Cost",
    "Error Reduction",
    "Revenue Benefit",
    "Other",
]

ROI_OWNER_ROLES = ["business_reviewer", "ai_leader", "domain_owner"]
ASSESSMENT_OWNER_ROLES = ["ai_leader", "portal_admin", "domain_owner", "business_reviewer"]


def empty_roi_row(category: str | None = None) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "category": category,
        "description": "",
        "year1": None,
        "year2": None,
        "year3": None,
    }


def empty_roi_payload(currency: str = "USD") -> dict:
    return {
        "currency": currency if currency in CURRENCY_OPTIONS else "USD",
        "rows": [],
        "totals": {"year1": 0.0, "year2": 0.0, "year3": 0.0, "total": 0.0},
        "investment_total": 0.0,
        "roi_percent": None,
    }


def _parse_year(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def compute_roi_totals(rows: list[dict]) -> dict:
    totals = {"year1": 0.0, "year2": 0.0, "year3": 0.0}
    for row in rows:
        for year in ("year1", "year2", "year3"):
            try:
                totals[year] += float(row.get(year) or 0)
            except (TypeError, ValueError):
                pass
    total = totals["year1"] + totals["year2"] + totals["year3"]
    return {
        "year1": round(totals["year1"], 2),
        "year2": round(totals["year2"], 2),
        "year3": round(totals["year3"], 2),
        "total": round(total, 2),
    }


def investment_from_estimate(estimate_data: dict | None) -> float:
    if not isinstance(estimate_data, dict):
        return 0.0
    lines = estimate_data.get("lines") if isinstance(estimate_data.get("lines"), dict) else {}
    if lines:
        totals = compute_estimate_totals(lines)
        return round(float(totals.get("year1") or 0) + float(totals.get("year2") or 0) + float(totals.get("year3") or 0), 2)
    totals = estimate_data.get("totals") if isinstance(estimate_data.get("totals"), dict) else {}
    return round(
        float(totals.get("year1") or 0) + float(totals.get("year2") or 0) + float(totals.get("year3") or 0),
        2,
    )


def compute_roi_percent(total_savings: float, investment_total: float) -> float | None:
    if investment_total is None or investment_total <= 0:
        return None
    return round(((total_savings - investment_total) / investment_total) * 100.0, 2)


def normalize_roi_data(
    raw: dict | None,
    *,
    default_currency: str = "USD",
    estimate_data: dict | None = None,
) -> dict:
    base = empty_roi_payload(default_currency)
    if not isinstance(raw, dict):
        investment = investment_from_estimate(estimate_data)
        base["investment_total"] = investment
        base["roi_percent"] = compute_roi_percent(0.0, investment)
        return base

    currency = (raw.get("currency") or default_currency or "USD").strip().upper()
    if currency not in CURRENCY_OPTIONS:
        currency = default_currency if default_currency in CURRENCY_OPTIONS else "USD"

    rows_in = raw.get("rows") if isinstance(raw.get("rows"), list) else []
    rows: list[dict] = []
    for src in rows_in:
        if not isinstance(src, dict):
            continue
        category = src.get("category")
        if category not in ROI_SAVING_CATEGORIES:
            category = None
        row_id = str(src.get("id") or uuid.uuid4())
        rows.append(
            {
                "id": row_id,
                "category": category,
                "description": (str(src.get("description") or "").strip())[:2000],
                "year1": _parse_year(src.get("year1")),
                "year2": _parse_year(src.get("year2")),
                "year3": _parse_year(src.get("year3")),
            }
        )

    totals = compute_roi_totals(rows)
    investment = investment_from_estimate(estimate_data)
    # Prefer recalculated investment from estimate; fall back to stored
    if investment <= 0:
        try:
            investment = float(raw.get("investment_total") or 0)
        except (TypeError, ValueError):
            investment = 0.0
    roi_percent = compute_roi_percent(totals["total"], investment)

    return {
        "currency": currency,
        "rows": rows,
        "totals": totals,
        "investment_total": round(investment, 2),
        "roi_percent": roi_percent,
    }


def roi_is_complete(data: dict) -> tuple[bool, str | None]:
    rows = data.get("rows") if isinstance(data.get("rows"), list) else []
    if not rows:
        return False, "Add at least one savings row before completing ROI."
    for idx, row in enumerate(rows, start=1):
        if not row.get("category"):
            return False, f"Row {idx}: saving category is required."
        if not (row.get("description") or "").strip():
            return False, f"Row {idx}: benefit description is required."
        has_cost = any(row.get(y) is not None for y in ("year1", "year2", "year3"))
        if not has_cost:
            return False, f"Row {idx}: enter at least one year of savings."
    return True, None
