-- Migration 014: Fairness & Bias Assessment fields on use cases (Analysis section)

ALTER TABLE use_cases ADD COLUMN bias_assessment_performed BOOLEAN DEFAULT 0 NOT NULL;
ALTER TABLE use_cases ADD COLUMN protected_attributes VARCHAR(500);
ALTER TABLE use_cases ADD COLUMN balancing_strategy VARCHAR(1000);
