-- Expand use case workflow statuses and add typed permissions / renamed roles.
-- Applied at app startup via database.run_migrations() + init_service; this file documents the intended schema.

-- permissions.permission_type: workflow | usecase | portal
-- ALTER TABLE permissions ADD COLUMN permission_type VARCHAR(20) DEFAULT 'portal' NOT NULL;

-- New workflow permissions (seeded by init_service):
--   workflow_new, workflow_analysis, workflow_review, workflow_estimate,
--   workflow_roi, workflow_ai_assessment, workflow_approved, workflow_rejected
-- New usecase permissions:
--   case_approve, case_reject

-- Role renames (in-place via init_service.migrate_legacy_role_names):
--   Admin -> portal_admin
--   Architect -> tech_architect
--   Reviewer -> business_reviewer
--   User -> general_user
-- New roles: ai_leader, domain_owner

-- use_cases.status CHECK expanded to include Estimate, ROI, AI Assessment
-- (SQLite: table rebuild; MySQL: DROP/ADD check_status)
