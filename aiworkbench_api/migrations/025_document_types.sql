-- Migration 025: Document type lookup and use_case_documents metadata
-- Compatible with SQLite by default.

CREATE TABLE IF NOT EXISTS document_types (
  doc_type_id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(250),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE use_case_documents ADD COLUMN document_type VARCHAR(80);
ALTER TABLE use_case_documents ADD COLUMN source VARCHAR(40);

ALTER TABLE use_cases ADD COLUMN deployment_model VARCHAR(40);
