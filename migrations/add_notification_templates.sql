-- Practice-customizable notification templates.
--
-- Backs the new notificationTemplates Drizzle table in shared/schema.ts.
-- Pure expand: a new empty table with no impact on existing rows or
-- existing code paths. Old app tasks that don't know about this table
-- continue running unaffected.

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  notification_type VARCHAR NOT NULL,
  channel VARCHAR NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_practice_type_channel_uq
  ON notification_templates (practice_id, notification_type, channel);
