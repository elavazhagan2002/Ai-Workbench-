-- Persist the latest documentation quality analysis per use case.
-- Compatible with SQLite. For MySQL, keep the same shape and replace
-- AUTOINCREMENT / timestamp syntax only if your environment requires it.

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
