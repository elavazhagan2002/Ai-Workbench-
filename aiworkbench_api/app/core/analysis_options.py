"""
Analysis-phase field options and ownership helpers.
"""

# Business analysis scoring options
FREQUENCY_OF_TASK_OPTIONS = ["Hourly", "Daily", "Weekly", "Monthly", "Yearly"]

CURRENT_EFFORT_OPTIONS = ["<1 hour", "1-5 Days", "5-20 Days", "20+ Days"]

USER_GROUP_SIZE_OPTIONS = ["500+", "151-500", "51-150", "11-50", "1-10"]

EFFICIENCY_IMPACT_OPTIONS = [">50%", "~20-50%", "<20%"]

QUALITY_COMPLIANCE_IMPACT_OPTIONS = [
    "Major reduction",
    "Moderate Improvement",
    "Low/no impact",
]

USER_URGENCY_OPTIONS = ["Critical (high adoption)", "Regular", "Infrequent"]

PROCESS_IMPACT_OPTIONS = [
    "High alignment - low SOP disruption",
    "Moderate alignment",
    "Low alignment - major process overhaul",
]

OPERATIONAL_COMPLIANCE_RISK_OPTIONS = ["Low Risk", "Medium Risk", "High Risk"]

# Technical analysis options
TOOL_COMPLEXITY_OPTIONS = [
    "simple standard api / out of the box",
    "Moderate custom logic",
    "Complex multi-system integration",
]

HOST_SYSTEM_CAPABILITY_OPTIONS = [
    "Fully supported natively",
    "On host system roadmap",
    "Partial / requires customization",
    "Not supported / not on roadmap",
]

DATA_PRIVACY_SECURITY_OPTIONS = ["Low", "Medium", "High"]

DEPLOYMENT_MODEL_OPTIONS = ["Cloud", "On-Premise", "Hybrid"]

# Derive technical feasibility label from complexity + host capability
_FEASIBILITY_MATRIX = {
    ("simple standard api / out of the box", "Fully supported natively"): "Yes",
    ("simple standard api / out of the box", "On host system roadmap"): "Yes",
    ("simple standard api / out of the box", "Partial / requires customization"): "Yes (Difficult)",
    ("simple standard api / out of the box", "Not supported / not on roadmap"): "Yes (Difficult)",
    ("Moderate custom logic", "Fully supported natively"): "Yes",
    ("Moderate custom logic", "On host system roadmap"): "Yes (Difficult)",
    ("Moderate custom logic", "Partial / requires customization"): "Yes (Difficult)",
    ("Moderate custom logic", "Not supported / not on roadmap"): "No",
    ("Complex multi-system integration", "Fully supported natively"): "Yes (Difficult)",
    ("Complex multi-system integration", "On host system roadmap"): "Yes (Difficult)",
    ("Complex multi-system integration", "Partial / requires customization"): "No",
    ("Complex multi-system integration", "Not supported / not on roadmap"): "No",
}


def derive_technical_feasibility(tool_complexity: str | None, host_capability: str | None) -> str | None:
    """Compute Technical Feasibility from Tool Complexity + Host System Capability."""
    if not tool_complexity or not host_capability:
        return None
    return _FEASIBILITY_MATRIX.get((tool_complexity, host_capability))


# Fields each track may edit while in Analysis (plus shared references)
TECHNICAL_ANALYSIS_FIELDS = frozenset({
    "ai_category",
    "feasibility",
    "tool_complexity",
    "host_system_capability",
    "data_privacy_security",
    "solution_design_overview",
    "deployment_model",
    "reference_links",
})

BUSINESS_ANALYSIS_FIELDS = frozenset({
    "use_case_title",
    "use_case_description",
    "intended_use",
    "expected_benefits",
    "intended_audience",
    "target_audience_type",
    "impacted_stakeholders",
    "human_in_loop_strategy",
    "bias_assessment_performed",
    "protected_attributes",
    "balancing_strategy",
    "frequency_of_task",
    "current_effort",
    "user_group_size",
    "efficiency_impact",
    "quality_compliance_impact",
    "user_urgency",
    "process_impact",
    "operational_compliance_risk",
    "reference_links",
})

# Roles eligible for Analysis assignment dropdowns (strict)
ANALYSIS_TECHNICAL_OWNER_ROLES = ["tech_architect"]
ANALYSIS_BUSINESS_OWNER_ROLES = ["business_reviewer"]

# Mandatory fields to complete each Analysis track (labels for error messages)
TECHNICAL_REQUIRED_FIELD_LABELS: dict[str, str] = {
    "ai_category": "AI Category",
    "tool_complexity": "Tool Complexity",
    "host_system_capability": "Host System Capability",
    "data_privacy_security": "Data Privacy & Security",
    "solution_design_overview": "Solution Design Overview",
    "deployment_model": "Deployment Model",
}

BUSINESS_REQUIRED_FIELD_LABELS: dict[str, str] = {
    "frequency_of_task": "Frequency of Task",
    "current_effort": "Current Effort",
    "user_group_size": "User Group Size",
    "efficiency_impact": "Efficiency Impact",
    "quality_compliance_impact": "Quality / Compliance Impact",
    "user_urgency": "User Urgency",
    "process_impact": "Process Impact / Org Alignment",
    "operational_compliance_risk": "Operational & Compliance Risk",
}


def _field_is_blank(value: object | None) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def missing_required_analysis_fields(track: str, use_case) -> list[str]:
    """Return human-readable labels of mandatory fields still empty for the track."""
    labels = TECHNICAL_REQUIRED_FIELD_LABELS if track == "technical" else BUSINESS_REQUIRED_FIELD_LABELS
    missing: list[str] = []
    for attr, label in labels.items():
        if _field_is_blank(getattr(use_case, attr, None)):
            missing.append(label)
    # Technical feasibility is derived; require it once complexity + host are set
    if track == "technical":
        if not _field_is_blank(getattr(use_case, "tool_complexity", None)) and not _field_is_blank(
            getattr(use_case, "host_system_capability", None)
        ):
            if _field_is_blank(getattr(use_case, "feasibility", None)):
                missing.append("Technical Feasibility")
    return missing

