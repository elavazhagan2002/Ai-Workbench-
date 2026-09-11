-- Migration 011: Impacted stakeholders (tag-style list) on use cases

ALTER TABLE use_cases ADD COLUMN impacted_stakeholders TEXT;
