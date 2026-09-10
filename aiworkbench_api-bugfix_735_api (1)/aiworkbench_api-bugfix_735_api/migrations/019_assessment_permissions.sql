-- Migration 019: Split use case assessment permissions

INSERT OR IGNORE INTO permissions (permission_id, permission_name, created_by, modified_by)
VALUES (lower(hex(randomblob(16))), 'initiate_assessment', 'system', 'system');

INSERT OR IGNORE INTO permissions (permission_id, permission_name, created_by, modified_by)
VALUES (lower(hex(randomblob(16))), 'contribute_assessment', 'system', 'system');

-- Roles that had legacy case_assess receive initiate_assessment
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_by, modified_by)
SELECT rp.role_id, p_new.permission_id, 'system', 'system'
FROM role_permissions rp
JOIN permissions p_old ON p_old.permission_id = rp.permission_id AND p_old.permission_name = 'case_assess'
JOIN permissions p_new ON p_new.permission_name = 'initiate_assessment';

-- Reviewer role receives contribute_assessment (initiate is for Architect/Admin via defaults)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_by, modified_by)
SELECT r.role_id, p.permission_id, 'system', 'system'
FROM roles r
JOIN permissions p ON p.permission_name = 'contribute_assessment'
WHERE r.role_name = 'Reviewer';
