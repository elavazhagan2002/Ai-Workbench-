-- Migration 015: AI Assessment Checklist templates

CREATE TABLE IF NOT EXISTS assessment_checklist_templates (
  template_id VARCHAR(36) PRIMARY KEY,
  version_number INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED')),
  is_active BOOLEAN DEFAULT 0 NOT NULL,
  source_template_id VARCHAR(36),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_template_id) REFERENCES assessment_checklist_templates(template_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS assessment_checklist_areas (
  area_id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id VARCHAR(36) NOT NULL,
  seq_no INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  FOREIGN KEY (template_id) REFERENCES assessment_checklist_templates(template_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_checklist_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL,
  sno VARCHAR(20) NOT NULL,
  assessment_item VARCHAR(500) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('Business', 'Governance', 'Legal & Compliance', 'Technical', 'Security & Data Privacy', 'Operations')),
  base_score REAL NOT NULL DEFAULT 0,
  penalty_factor REAL NOT NULL DEFAULT 1.0,
  allowed_checklist_items TEXT,
  FOREIGN KEY (area_id) REFERENCES assessment_checklist_areas(area_id) ON DELETE CASCADE
);
