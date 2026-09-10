"""
Use-case workflow states and permission mapping.
"""

# Primary governance workflow (non-legacy)
WORKFLOW_STATUSES = [
    "New",
    "Analysis",
    "Review",
    "Estimate",
    "ROI",
    "AI Assessment",
    "Approved",
    "Rejected",
]

LEGACY_STATUSES = ["Development", "Testing", "Production", "Retired"]

ALL_VALID_STATUSES = set(WORKFLOW_STATUSES + LEGACY_STATUSES)

# Forward transitions for non-portal_admin users. Reject allowed from any non-terminal state.
FORWARD_NEXT_NON_ADMIN = {
    "New": ["Analysis", "Rejected"],
    "Analysis": ["Review", "Rejected"],
    "Review": ["Estimate", "Rejected"],
    "Estimate": ["ROI", "Rejected"],
    "ROI": ["AI Assessment", "Rejected"],
    "AI Assessment": ["Approved", "Rejected"],
    "Approved": [],
    "Rejected": [],
}

# Full map including legacy lifecycle (portal_admin override path)
WORKFLOW_NEXT = {
    **FORWARD_NEXT_NON_ADMIN,
    "Development": ["Testing", "Production", "Retired"],
    "Testing": ["Production", "Retired"],
    "Production": ["Retired"],
    "Retired": [],
}

# Permission required to transition *into* a status
STATUS_TO_WORKFLOW_PERMISSION = {
    "New": "workflow_new",
    "Analysis": "workflow_analysis",
    "Review": "workflow_review",
    "Estimate": "workflow_estimate",
    "ROI": "workflow_roi",
    "AI Assessment": "workflow_ai_assessment",
    "Approved": "workflow_approved",
    "Rejected": "workflow_rejected",
}

WORKFLOW_PERMISSIONS = list(STATUS_TO_WORKFLOW_PERMISSION.values())

USECASE_ACTION_PERMISSIONS = [
    "case_create",
    "case_edit",
    "case_view",
    "case_delete",
    "case_assign",
    "case_approve",
    "case_reject",
    "case_comment",
    "case_review",
]

# Domain-scoped permissions that domain owners effectively receive for owned domains
DOMAIN_SCOPED_PERMISSIONS = set(
    WORKFLOW_PERMISSIONS
    + [
        "case_create",
        "case_edit",
        "case_view",
        "case_delete",
        "case_assign",
        "case_approve",
        "case_reject",
        "case_comment",
        "case_review",
        "edit_domain",
        "domain_access",
        "initiate_assessment",
        "contribute_assessment",
        "map_demo",
        "view_demo",
        "view_live_demo",
        "view_document",
        "view_infographic",
        "manage_blog",
        "view_blog",
        "dashboard_domain",
        "dashboard_individual",
    ]
)

PORTAL_ADMIN_ROLE = "portal_admin"
DOMAIN_OWNER_ROLE = "domain_owner"

ROLE_RENAMES = {
    "Admin": "portal_admin",
    "Architect": "tech_architect",
    "Reviewer": "business_reviewer",
    "User": "general_user",
}

TECHNICAL_OWNER_ROLES = ["tech_architect", "portal_admin", "ai_leader"]
BUSINESS_OWNER_ROLES = ["business_reviewer", "ai_leader", "domain_owner"]
