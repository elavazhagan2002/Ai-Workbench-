"""
ROI-phase savings option lists and helpers.
"""
from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.core.estimate_options import (
    CURRENCY_OPTIONS,
    MAX_ESTIMATE_AMOUNT,
    compute_estimate_totals,
)

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
TWO_PLACES = Decimal("0.01")


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
    """ROI investment is Estimate Year 1 + Year 2 + Year 3 only."""
    if not isinstance(estimate_data, dict):
        return 0.0
    lines = estimate_data.get("lines") if isinstance(estimate_data.get("lines"), dict) else {}
    if lines:
        totals = compute_estimate_totals(lines)
        return round(
            float(totals.get("year1") or 0)
            + float(totals.get("year2") or 0)
            + float(totals.get("year3") or 0),
            2,
        )
    totals = estimate_data.get("totals") if isinstance(estimate_data.get("totals"), dict) else {}
    return round(
        float(totals.get("year1") or 0)
        + float(totals.get("year2") or 0)
        + float(totals.get("year3") or 0),
        2,
    )


def compute_roi_percent(total_savings: float, investment_total: float) -> float | None:
    if investment_total is None or investment_total <= 0:
        return None
    return round(((total_savings - investment_total) / investment_total) * 100.0, 2)


def _estimate_currency(estimate_data: dict | None, default_currency: str) -> str:
    if isinstance(estimate_data, dict):
        value = str(estimate_data.get("currency") or "").strip().upper()
        if value in CURRENCY_OPTIONS:
            return value
    fallback = str(default_currency or "USD").strip().upper()
    return fallback if fallback in CURRENCY_OPTIONS else "USD"


def _amount_error(value: object, label: str) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return f"{label} must be a valid number."
    try:
        number = Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, TypeError, ValueError):
        return f"{label} must be a valid number."
    if not number.is_finite():
        return f"{label} must be a valid number."
    if number < 0:
        return f"{label} cannot be negative."
    if number > MAX_ESTIMATE_AMOUNT:
        return f"{label} is too large."
    if number != number.quantize(TWO_PLACES, rounding=ROUND_HALF_UP):
        return f"{label} can have at most 2 decimal places."
    return None


def validate_roi_data(data: dict | None, *, require_complete: bool = False) -> str | None:
    """Validate raw ROI input without silently discarding invalid values."""
    if not isinstance(data, dict):
        return "ROI data is required." if require_complete else None

    currency = str(data.get("currency") or "").strip().upper()
    if currency and currency not in CURRENCY_OPTIONS:
        return "Choose a valid currency."

    rows_value = data.get("rows")
    if rows_value is not None and not isinstance(rows_value, list):
        return "ROI rows must be a list."
    rows = rows_value if isinstance(rows_value, list) else []
    if require_complete and not rows:
        return "Add at least one savings row before completing ROI."

    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            return f"Row {idx}: enter a valid savings row."
        category = row.get("category")
        if category not in (None, "") and category not in ROI_SAVING_CATEGORIES:
            return f"Row {idx}: choose a valid saving category."
        if require_complete and not category:
            return f"Row {idx}: saving category is required."

        description = row.get("description")
        if description not in (None, "") and not isinstance(description, str):
            return f"Row {idx}: benefit description must be text."
        if isinstance(description, str) and len(description) > 2000:
            return f"Row {idx}: benefit description can have at most 2000 characters."
        if require_complete and not str(description or "").strip():
            return f"Row {idx}: benefit description is required."

        has_savings = False
        for year, label in (("year1", "Year 1"), ("year2", "Year 2"), ("year3", "Year 3")):
            value = row.get(year)
            if value not in (None, ""):
                has_savings = True
            error = _amount_error(value, f"Row {idx} {label} savings")
            if error:
                return error
        if require_complete and not has_savings:
            return f"Row {idx}: enter at least one year of savings."
    return None


def normalize_roi_data(
    raw: dict | None,
    *,
    default_currency: str = "USD",
    estimate_data: dict | None = None,
) -> dict:
    currency = _estimate_currency(estimate_data, default_currency)
    base = empty_roi_payload(currency)
    if not isinstance(raw, dict):
        investment = investment_from_estimate(estimate_data)
        base["investment_total"] = investment
        base["roi_percent"] = compute_roi_percent(0.0, investment)
        return base

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
    roi_percent = compute_roi_percent(totals["total"], investment)

    return {
        "currency": currency,
        "rows": rows,
        "totals": totals,
        "investment_total": round(investment, 2),
        "roi_percent": roi_percent,
    }


def roi_is_complete(data: dict) -> tuple[bool, str | None]:
    error = validate_roi_data(data, require_complete=True)
    return error is None, error
