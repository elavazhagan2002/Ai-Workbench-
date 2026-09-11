-- In-app notification inbox (per-user event feed).
-- SQLite-compatible. MySQL deployments can apply via run_migrations() or manually.

CREATE TABLE IF NOT EXISTS notifications (
  notification_id VARCHAR(36) PRIMARY KEY,
  recipient_user_id VARCHAR(36) NOT NULL,
  actor_user_id VARCHAR(36) NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(500) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  entity_type VARCHAR(30) NULL,
  entity_id VARCHAR(36) NULL,
  domain_id VARCHAR(36) NULL,
  link VARCHAR(300) NULL,
  actions JSON NULL,
  payload JSON NULL,
  is_read BOOLEAN NOT NULL DEFAULT 0,
  read_dt DATETIME NULL,
  dismissed_dt DATETIME NULL,
  created_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_notifications_recipient_user_id ON notifications (recipient_user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications (type);
CREATE INDEX IF NOT EXISTS ix_notifications_recipient_created ON notifications (recipient_user_id, created_dt);
CREATE INDEX IF NOT EXISTS ix_notifications_recipient_unread ON notifications (recipient_user_id, is_read);
