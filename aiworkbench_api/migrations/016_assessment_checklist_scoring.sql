-- Migration 016: Base score and penalty factor for assessment checklist items

ALTER TABLE assessment_checklist_items ADD COLUMN base_score REAL NOT NULL DEFAULT 0;
ALTER TABLE assessment_checklist_items ADD COLUMN penalty_factor REAL NOT NULL DEFAULT 1.0;
