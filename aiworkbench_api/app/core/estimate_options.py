"""
Estimate-phase cost option lists and helpers.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

INFRA_COST_TYPES = ["Cloud", "On-Premise"]
BUILD_COST_TYPES = ["Inhouse", "Vendor"]
VALIDATION_COST_TYPES = ["Internal", "External"]
SUPPORT_COST_TYPES = ["Inhouse", "Vendor"]
LLM_TOKEN_COST_TYPES = ["Claude", "Azure", "Others"]
CHANGE_MGMT_COST_TYPES = ["High", "Medium", "Low"]

CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "INR", "AED", "SGD", "JPY", "AUD", "CAD"]

ESTIMATE_LINE_KEYS = [
    "infra",
    "build",
    "validation",
    "support",
    "llm_token",
    "change_management",
]

ESTIMATE_LINE_LABELS = {
    "infra": "Infra Cost",
    "build": "Build Cost",
    "validation": "Validation/Testing Cost",
    "support": "Support Cost",
    "llm_token": "LLM Token Cost",
    "change_management": "Change Management Cost",
}

ESTIMATE_LINE_TYPES = {
    "infra": INFRA_COST_TYPES,
    "build": BUILD_COST_TYPES,
    "validation": VALIDATION_COST_TYPES,
    "support": SUPPORT_COST_TYPES,
    "llm_token": LLM_TOKEN_COST_TYPES,
    "change_management": CHANGE_MGMT_COST_TYPES,
}

VENDOR_ANSWER_VALUES = ("yes", "no", "na", True, False)

MAX_ESTIMATE_AMOUNT = Decimal("999999999999.99")
TWO_PLACES = Decimal("0.01")


def empty_estimate_line() -> dict:
    return {"type": None, "actual_cost": None, "year1": None, "year2": None, "year3": None}


VENDOR_ASSESSMENT_QUESTIONS = [
    {
        "id": "vendor_legal_entity",
        "question": "Is the vendor a legally registered entity with a named contracting party and jurisdiction?",
    },
    {
        "id": "vendor_security_certs",
        "question": "Does the vendor hold current security certifications (e.g. ISO 27001, SOC 2) relevant to this use case?",
    },
    {
        "id": "vendor_data_residency",
        "question": "Can the vendor confirm data residency, processing locations, and subprocessors for this solution?",
    },
    {
        "id": "vendor_no_train_on_data",
        "question": "Will customer data and prompts be excluded from model training unless explicitly contracted?",
    },
    {
        "id": "vendor_privacy_dpa",
        "question": "Is a Data Processing Agreement (or equivalent) available covering confidentiality, retention, and deletion?",
    },
    {
        "id": "vendor_access_control",
        "question": "Does the vendor support least-privilege access, SSO/MFA, and audit logs for operator activity?",
    },
    {
        "id": "vendor_model_transparency",
        "question": "Can the vendor describe the model/provider stack, update cadence, and known limitations?",
    },
    {
        "id": "vendor_bias_testing",
        "question": "Has the vendor documented bias, fairness, or safety testing for the intended use?",
    },
    {
        "id": "vendor_sla_support",
        "question": "Are SLA, incident response, and support hours defined for production use?",
    },
    {
        "id": "vendor_ip_exit",
        "question": "Are IP ownership of outputs and an exit plan (data return/deletion) contractually defined?",
    },
]


def is_vendor_build(data: dict | None) -> bool:
    if not isinstance(data, dict):
        return False
    lines = data.get("lines") if isinstance(data.get("lines"), dict) else {}
    build = lines.get("build") if isinstance(lines.get("build"), dict) else {}
    return str(build.get("type") or "").strip().lower() == "vendor"


def _to_decimal(value: object) -> Decimal | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise InvalidOperation("boolean is not an amount")
    text = str(value).strip().replace(",", "")
    if text == "":
        return None
    number = Decimal(text)
    if not number.is_finite():
        raise InvalidOperation("non-finite")
    return number


def _amount_error(value: object, label: str, required: bool = False) -> str | None:
    try:
        number = _to_decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return f"{label} must be a valid number."
    if number is None:
        return f"{label} is required." if required else None
    if number < 0:
        return f"{label} cannot be negative."
    if number > MAX_ESTIMATE_AMOUNT:
        return f"{label} is too large."
    quantized = number.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    if (number - quantized).copy_abs() > Decimal("0.001"):
        return f"{label} can have at most 2 decimal places."
    return None


def _normalize_vendor_answer(value: object) -> str | None:
    if value is True or value == "yes":
        return "yes"
    if value is False or value == "no":
        return "no"
    if value == "na":
        return "na"
    return None


def validate_estimate_data(data: dict | None, *, require_complete: bool = False) -> str | None:
    """Return first validation error, or None if valid."""
    if not isinstance(data, dict):
        return "Estimate data is required." if require_complete else None

    currency = str(data.get("currency") or "").strip().upper()
    if currency and currency not in CURRENCY_OPTIONS:
        return "Choose a valid currency."
    if require_complete and not currency:
        return "Currency is required."

    lines = data.get("lines") if isinstance(data.get("lines"), dict) else {}
    for key in ESTIMATE_LINE_KEYS:
        line = lines.get(key) if isinstance(lines.get(key), dict) else {}
        label = ESTIMATE_LINE_LABELS.get(key, key)
        allowed = ESTIMATE_LINE_TYPES[key]
        line_type = line.get("type")
        if require_complete and not line_type:
            return f"{label}: type is required."
        if line_type and line_type not in allowed:
            return f"{label}: choose a valid type."
        for field, field_label in (
            ("year1", "Year 1"),
            ("year2", "Year 2"),
            ("year3", "Year 3"),
        ):
            err = _amount_error(
                line.get(field),
                f"{label} {field_label}",
                required=require_complete,
            )
            if err:
                return err
        leftover_actual = line.get("actual_cost")
        if leftover_actual not in (None, ""):
            leftover_err = _amount_error(leftover_actual, f"{label} actual cost", required=False)
            if leftover_err:
                return leftover_err

    checklist = data.get("vendor_checklist") if isinstance(data.get("vendor_checklist"), dict) else {}
    for item in VENDOR_ASSESSMENT_QUESTIONS:
        raw = checklist.get(item["id"], None)
        if raw in (None, ""):
            continue
        if _normalize_vendor_answer(raw) is None:
            return "Vendor assessment answers must be Yes, No, or N/A."
    return None


def empty_estimate_payload(currency: str = "USD") -> dict:
    return {
        "currency": currency,
        "lines": {key: empty_estimate_line() for key in ESTIMATE_LINE_KEYS},
        "totals": {"year1": 0, "year2": 0, "year3": 0},
        "vendor_checklist": {},
    }


def compute_estimate_totals(lines: dict) -> dict:
    totals = {"year1": Decimal("0"), "year2": Decimal("0"), "year3": Decimal("0")}
    for key in ESTIMATE_LINE_KEYS:
        line = lines.get(key) or {}
        for year in ("year1", "year2", "year3"):
            try:
                amount = _to_decimal(line.get(year))
            except (InvalidOperation, TypeError, ValueError):
                amount = None
            if amount is not None and amount >= 0:  
                totals[year] += amount.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    return {k: float(v.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)) for k, v in totals.items()}


def _parse_amount(value: object) -> float | None:
    try:
        number = _to_decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return None
    if number is None:
        return None
    quantized = number.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    if (number - quantized).copy_abs() > Decimal("0.001"):
        return float(number)
    return float(quantized)


def normalize_estimate_data(raw: dict | None, default_currency: str = "USD") -> dict:
    base = empty_estimate_payload(default_currency)
    if not isinstance(raw, dict):
        return base
    currency = (raw.get("currency") or default_currency or "USD").strip().upper()
    if currency not in CURRENCY_OPTIONS:
        currency = default_currency if default_currency in CURRENCY_OPTIONS else "USD"
    lines_in = raw.get("lines") if isinstance(raw.get("lines"), dict) else {}
    lines = {}
    for key in ESTIMATE_LINE_KEYS:
        src = lines_in.get(key) if isinstance(lines_in.get(key), dict) else {}
        line_type = src.get("type")
        allowed = ESTIMATE_LINE_TYPES[key]
        if line_type not in allowed:
            line_type = None
        lines[key] = {
            "type": line_type,
            "actual_cost": _parse_amount(src.get("actual_cost")),
            "year1": _parse_amount(src.get("year1")),
            "year2": _parse_amount(src.get("year2")),
            "year3": _parse_amount(src.get("year3")),
        }
    totals = compute_estimate_totals(lines)
    vendor_in = raw.get("vendor_checklist") if isinstance(raw.get("vendor_checklist"), dict) else {}
    vendor_checklist = {}
    for item in VENDOR_ASSESSMENT_QUESTIONS:
        answer = _normalize_vendor_answer(vendor_in.get(item["id"]))
        if answer is not None:
            vendor_checklist[item["id"]] = answer
    return {
        "currency": currency,
        "lines": lines,
        "totals": totals,
        "vendor_checklist": vendor_checklist,
    }
