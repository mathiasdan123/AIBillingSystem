-- Server-side persistence for Blanche chat history.
-- One row per (user, practice). Additive, safe for rolling deploys.

CREATE TABLE IF NOT EXISTS blanche_conversations (
  id          SERIAL PRIMARY KEY,
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  -- Real UNIQUE constraint (not just a unique index) so Drizzle's
  -- onConflictDoUpdate target is unambiguous and stable.
  CONSTRAINT blanche_conversations_user_practice_uq UNIQUE (user_id, practice_id)
);
