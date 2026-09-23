-- Migration 002: Organization types lookup and user organization_type field
-- Compatible with SQLite by default.
-- For MySQL:
--   - Replace lower(hex(randomblob(16))) with UUID()
--   - Replace AUTOINCREMENT with AUTO_INCREMENT
--   - Adjust DATETIME default expressions if needed.

-- Create organization_types lookup table
CREATE TABLE IF NOT EXISTS organization_types (
  org_type_id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(250),
  created_by VARCHAR(36),
  created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_by VARCHAR(36),
  modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add optional organization_type column to users to capture a user's type
ALTER TABLE users ADD COLUMN organization_type VARCHAR(100);

