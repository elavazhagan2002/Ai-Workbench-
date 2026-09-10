-- AI Workbench – Baseline schema and initial data
-- Single script for fresh installs. Compatible with SQLite (default).
-- For MySQL: replace lower(hex(randomblob(16))) with UUID(), AUTOINCREMENT with AUTO_INCREMENT, INSERT OR IGNORE with INSERT IGNORE.

-- =============================================================================
-- SCHEMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS permissions (
  permission_id VARCHAR(36) PRIMARY KEY,
  permission_name VARCHAR(30) NOT NULL UNIQUE,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  role_id VARCHAR(36) PRIMARY KEY,
  role_name VARCHAR(25) NOT NULL UNIQUE,
  role_description VARCHAR(250),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(36) NOT NULL,
  permission_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(36) PRIMARY KEY,
  user_image TEXT,
  user_name VARCHAR(25) NOT NULL,
  user_email VARCHAR(100) NOT NULL UNIQUE,
  organization VARCHAR(100),
  user_pwd VARCHAR(255) NOT NULL,
  role_id VARCHAR(36),
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

CREATE TABLE IF NOT EXISTS domains (
  domain_id VARCHAR(36) PRIMARY KEY,
  domain_short_name VARCHAR(8) NOT NULL UNIQUE,
  domain_name VARCHAR(50) NOT NULL,
  domain_detail VARCHAR(250),
  owner_id VARCHAR(36),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(user_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS domain_access (
  domain_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain_id, user_id),
  FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_cases (
  use_case_id VARCHAR(36) PRIMARY KEY,
  domain_id VARCHAR(36) NOT NULL,
  use_case_name VARCHAR(30) NOT NULL,
  use_case_title VARCHAR(100),
  use_case_description VARCHAR(1500),
  expected_benefits VARCHAR(1000),
  department VARCHAR(30),
  ai_category CHAR(1) CHECK (ai_category IN ('P', 'G', 'A', 'S')),
  feasibility TEXT CHECK (feasibility IN ('Yes', 'No', 'Yes (Difficult)')),
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Analysis', 'Review', 'Approved', 'Rejected', 'Development', 'Testing', 'Production', 'Retired')),
  intended_audience VARCHAR(200),
  technical_owner VARCHAR(36),
  business_owner VARCHAR(36),
  solution_design_overview TEXT,
  human_in_loop_strategy VARCHAR(500),
  bias_assessment_performed BOOLEAN DEFAULT 0 NOT NULL,
  protected_attributes VARCHAR(500),
  balancing_strategy VARCHAR(1000),
  rejection_reason TEXT,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE CASCADE,
  FOREIGN KEY (technical_owner) REFERENCES users(user_id),
  FOREIGN KEY (business_owner) REFERENCES users(user_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_data (
  data_req_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  data_req VARCHAR(250),
  data_source VARCHAR(30),
  volume VARCHAR(20),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_risk_reviews (
  risk_review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  risk_category TEXT CHECK (risk_category IN ('Operational', 'Business', 'Technical')),
  risk_title VARCHAR(50),
  risk_description TEXT,
  risk_likelihood TEXT CHECK (risk_likelihood IN ('low', 'medium', 'high', 'critical')),
  risk_impact TEXT CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
  assigned_to VARCHAR(36),
  mitigation_strategy TEXT,
  closure_comment VARCHAR(500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(user_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_comments (
  comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  comment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  comment_by VARCHAR(36) NOT NULL,
  comment VARCHAR(300),
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (comment_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_tags (
  tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  tag_name VARCHAR(50) NOT NULL,
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  url VARCHAR(500) NOT NULL,
  label VARCHAR(200),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_documents (
  document_id INTEGER PRIMARY KEY AUTOINCREMENT,
  use_case_id VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  content_type VARCHAR(100),
  size_bytes INTEGER,
  uploaded_by VARCHAR(36),
  uploaded_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_documentation_quality_results (
  use_case_id VARCHAR(36) PRIMARY KEY,
  overall_score INTEGER NOT NULL,
  strengths_count INTEGER NOT NULL DEFAULT 0,
  improvements_count INTEGER NOT NULL DEFAULT 0,
  status_label VARCHAR(40) NOT NULL,
  analyzed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_updated_at DATETIME,
  analysis_payload TEXT NOT NULL,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id VARCHAR(36) PRIMARY KEY,
  audit_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id VARCHAR(36),
  details TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS system_config (
  config_id VARCHAR(36) PRIMARY KEY,
  config_data TEXT NOT NULL DEFAULT '{}',
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

INSERT OR IGNORE INTO permissions (permission_id, permission_name) VALUES
  (lower(hex(randomblob(16))), 'audit_access'),
  (lower(hex(randomblob(16))), 'settings_access'),
  (lower(hex(randomblob(16))), 'create_domain'),
  (lower(hex(randomblob(16))), 'edit_domain'),
  (lower(hex(randomblob(16))), 'delete_domain'),
  (lower(hex(randomblob(16))), 'domain_access'),
  (lower(hex(randomblob(16))), 'domain_owner'),
  (lower(hex(randomblob(16))), 'case_create'),
  (lower(hex(randomblob(16))), 'case_edit'),
  (lower(hex(randomblob(16))), 'case_delete'),
  (lower(hex(randomblob(16))), 'case_view'),
  (lower(hex(randomblob(16))), 'case_assign'),
  (lower(hex(randomblob(16))), 'case_review'),
  (lower(hex(randomblob(16))), 'case_comment'),
  (lower(hex(randomblob(16))), 'map_demo'),
  (lower(hex(randomblob(16))), 'view_demo'),
  (lower(hex(randomblob(16))), 'view_live_demo'),
  (lower(hex(randomblob(16))), 'view_document'),
  (lower(hex(randomblob(16))), 'view_infographic');

INSERT OR IGNORE INTO roles (role_id, role_name, role_description) VALUES
  (lower(hex(randomblob(16))), 'Admin', 'Full system administrator with all permissions'),
  (lower(hex(randomblob(16))), 'User', 'Standard user with basic permissions'),
  (lower(hex(randomblob(16))), 'Architect', 'Architect with use case management and assignment capabilities'),
  (lower(hex(randomblob(16))), 'Reviewer', 'Reviewer with view-only access and review/comment capabilities');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'Admin';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'User'
  AND p.permission_name IN ('case_create', 'domain_access', 'case_view', 'case_comment','view_demo', 'view_document', 'view_infographic'  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'Architect'
  AND p.permission_name IN ('case_create', 'case_assign', 'case_review', 'domain_access', 'case_edit', 'case_view', 'domain_owner', 'case_comment', 'map_demo', 'view_demo', 'view_live_demo', 'view_document', 'view_infographic');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'Reviewer'
  AND p.permission_name IN ('case_create', 'case_assign', 'case_review', 'domain_access', 'case_edit', 'case_view', 'domain_owner', 'case_comment', 'view_demo', 'view_live_demo', 'view_document', 'view_infographic');

INSERT OR IGNORE INTO system_config (config_id, config_data) VALUES
  (lower(hex(randomblob(16))), '{"dataTable": {"rowsPerPage": 10}, "llm": {"provider": "Environment", "provider_id": "env", "config_source": "environment", "azure": {}, "gemini": {}, "openai": {}}, "storage": {"type": "Local"}, "integrations": {"airflow": {}, "mlflow": {}}, "theme": "dark"}');
