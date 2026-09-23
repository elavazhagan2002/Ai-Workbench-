-- Authenticator-app TOTP enrollment fields on users.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_prompt_seen BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_confirmed_at DATETIME;
ALTER TABLE users ADD COLUMN preferred_mfa_method VARCHAR(20) NOT NULL DEFAULT 'email';
