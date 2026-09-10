-- Use case assessment instances (one per use case)

CREATE TABLE IF NOT EXISTS use_case_assessments (
  assessment_id VARCHAR(36) PRIMARY KEY,
  use_case_id VARCHAR(36) NOT NULL UNIQUE,
  template_id VARCHAR(36) NOT NULL,
  template_version_number INTEGER NOT NULL,
  template_name VARCHAR(200) NOT NULL,
  template_snapshot TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'CLOSED')),
  initiated_by VARCHAR(36) NOT NULL,
  initiated_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  closed_by VARCHAR(36),
  closed_dt DATETIME,
  next_review_date DATETIME,
  total_score REAL,
  risk_classification VARCHAR(20),
  overall_findings TEXT,
  area_summaries TEXT,
  question_scores TEXT,
  ai_prefill_applied BOOLEAN DEFAULT 0 NOT NULL,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES assessment_checklist_templates(template_id),
  FOREIGN KEY (initiated_by) REFERENCES users(user_id),
  FOREIGN KEY (closed_by) REFERENCES users(user_id),
  FOREIGN KEY (modified_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS use_case_assessment_responses (
  response_id VARCHAR(36) PRIMARY KEY,
  assessment_id VARCHAR(36) NOT NULL,
  template_item_id INTEGER NOT NULL,
  area_id INTEGER NOT NULL,
  sno VARCHAR(20) NOT NULL,
  selected_answers TEXT,
  comment TEXT,
  answered_by VARCHAR(36),
  answered_dt DATETIME,
  last_modified_by VARCHAR(36),
  last_modified_dt DATETIME,
  FOREIGN KEY (assessment_id) REFERENCES use_case_assessments(assessment_id) ON DELETE CASCADE,
  FOREIGN KEY (answered_by) REFERENCES users(user_id),
  FOREIGN KEY (last_modified_by) REFERENCES users(user_id),
  UNIQUE (assessment_id, template_item_id)
);

CREATE TABLE IF NOT EXISTS use_case_assessment_response_history (
  history_id VARCHAR(36) PRIMARY KEY,
  assessment_id VARCHAR(36) NOT NULL,
  template_item_id INTEGER NOT NULL,
  sno VARCHAR(20) NOT NULL,
  selected_answers TEXT,
  comment TEXT,
  changed_by VARCHAR(36) NOT NULL,
  changed_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  change_action VARCHAR(20) NOT NULL DEFAULT 'updated',
  FOREIGN KEY (assessment_id) REFERENCES use_case_assessments(assessment_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_use_case_assessment_responses_assessment
  ON use_case_assessment_responses(assessment_id);

CREATE INDEX IF NOT EXISTS idx_use_case_assessment_history_assessment
  ON use_case_assessment_response_history(assessment_id);
