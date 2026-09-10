-- Trusted login IP addresses for email passcode MFA on new-IP sign-in.
-- SQLite-compatible migration. MySQL deployments should use AUTO_INCREMENT
-- for id if applying manually outside the app's programmatic migrations.

CREATE TABLE IF NOT EXISTS user_login_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id VARCHAR(36) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_via_passcode BOOLEAN NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, ip_address),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_user_login_ips_user_id ON user_login_ips(user_id);
CREATE INDEX IF NOT EXISTS ix_user_login_ips_ip_address ON user_login_ips(ip_address);
