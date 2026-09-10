-- Migration 008: Extended metadata for use case data requirements

ALTER TABLE use_case_data ADD COLUMN data_classification VARCHAR(30);
ALTER TABLE use_case_data ADD COLUMN data_owner VARCHAR(100);
ALTER TABLE use_case_data ADD COLUMN data_usage TEXT;
ALTER TABLE use_case_data ADD COLUMN is_pii_phi_involved BOOLEAN DEFAULT 0 NOT NULL;
ALTER TABLE use_case_data ADD COLUMN dataset_type VARCHAR(20);
ALTER TABLE use_case_data ADD COLUMN data_lineage_available BOOLEAN DEFAULT 0 NOT NULL;
ALTER TABLE use_case_data ADD COLUMN data_quality_assessed BOOLEAN DEFAULT 0 NOT NULL;
ALTER TABLE use_case_data ADD COLUMN data_freshness_confirmed BOOLEAN DEFAULT 0 NOT NULL;
