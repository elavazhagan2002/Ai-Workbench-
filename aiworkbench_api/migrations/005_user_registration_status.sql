-- Registration approval state for self-registered users.
-- Keeps pending/rejected registration requests separate from normal inactive users.

ALTER TABLE users ADD COLUMN registration_status VARCHAR(20) NOT NULL DEFAULT 'approved';

UPDATE users
SET registration_status = 'pending'
WHERE is_active = 0
  AND interested_domain_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM domain_access da WHERE da.user_id = users.user_id
  );

CREATE INDEX IF NOT EXISTS ix_users_registration_status ON users(registration_status);
