-- Migration 007: Intended use field on use cases
-- Compatible with SQLite by default.
-- For MySQL, use VARCHAR(1000) if ADD COLUMN fails on duplicate.

ALTER TABLE use_cases ADD COLUMN intended_use VARCHAR(1000);
