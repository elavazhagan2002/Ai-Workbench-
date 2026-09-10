-- Migration 017: Risk classification ranges on templates; answer-level base scores in JSON

ALTER TABLE assessment_checklist_templates ADD COLUMN risk_classification_ranges TEXT;
