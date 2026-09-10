"""
Reusable password policy validation and strength scoring.
"""
from typing import Literal, TypedDict

PasswordStrength = Literal["weak", "medium", "strong"]


class PasswordPolicyResult(TypedDict):
    is_valid: bool
    errors: list[str]
    checks: dict[str, bool]


class PasswordStrengthResult(TypedDict):
    strength: PasswordStrength
    score: int
    feedback: list[str]


def _has_special_character(password: str) -> bool:
    """Treat visible non-alphanumeric, non-whitespace characters as special."""
    return any(not char.isalnum() and not char.isspace() for char in password)


def validate_password_policy(password: str) -> PasswordPolicyResult:
    """Validate the registration password policy and return structured results."""
    value = password or ""
    checks = {
        "min_length": len(value) >= 8,
        "has_uppercase": any(char.isupper() for char in value),
        "has_lowercase": any(char.islower() for char in value),
        "has_number": any(char.isdigit() for char in value),
        "has_special": _has_special_character(value),
    }

    errors: list[str] = []
    if not checks["min_length"]:
        errors.append("Password must be at least 8 characters")
    if not checks["has_uppercase"]:
        errors.append("Password must contain at least one uppercase letter")
    if not checks["has_lowercase"]:
        errors.append("Password must contain at least one lowercase letter")
    if not checks["has_number"]:
        errors.append("Password must contain at least one number")
    if not checks["has_special"]:
        errors.append("Password must contain at least one special character")

    return {
        "is_valid": not errors,
        "errors": errors,
        "checks": checks,
    }


def evaluate_password_strength(password: str) -> PasswordStrengthResult:
    """
    Classify password strength with a deterministic 0-4 score.

    Weak passwords fail policy or only barely satisfy it. Strong passwords satisfy
    the policy with higher length and at least one extra numeric/special signal.
    """
    value = password or ""
    validation = validate_password_policy(value)
    passed_checks = sum(1 for passed in validation["checks"].values() if passed)

    if not validation["is_valid"]:
        return {
            "strength": "weak",
            "score": min(2, max(0, passed_checks - 1)),
            "feedback": validation["errors"],
        }

    digit_count = sum(1 for char in value if char.isdigit())
    special_count = sum(1 for char in value if not char.isalnum() and not char.isspace())

    if len(value) <= 9:
        return {
            "strength": "weak",
            "score": 2,
            "feedback": ["Use at least 10 characters for a stronger password"],
        }

    if len(value) >= 12 and (digit_count >= 2 or special_count >= 2):
        return {
            "strength": "strong",
            "score": 4,
            "feedback": [],
        }

    feedback: list[str] = []
    if len(value) < 12:
        feedback.append("Use at least 12 characters for a strong password")
    if digit_count < 2 and special_count < 2:
        feedback.append("Add another number or special character for a stronger password")

    return {
        "strength": "medium",
        "score": 3,
        "feedback": feedback,
    }
