-- Migration 010: Target audience type (multi-select) on use cases

ALTER TABLE use_cases ADD COLUMN target_audience_type TEXT;
