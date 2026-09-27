-- ============================================================================
-- Nerde.com — 003_oauth.sql
-- ADDITIVE schema-freeze exception (approved for MVP_BACKLOG P1-01): OAuth
-- account-linking columns on users for Google login. NULLs = pure
-- email+password account; existing rows are untouched.
-- ============================================================================

ALTER TABLE users ADD COLUMN oauth_provider TEXT;  -- 'google' | NULL
ALTER TABLE users ADD COLUMN oauth_sub TEXT;       -- provider's stable subject id

-- One OAuth identity links to exactly one local account; NULL rows are exempt
-- (same pattern as places_source_ref in 001).
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth
  ON users(oauth_provider, oauth_sub)
  WHERE oauth_provider IS NOT NULL;
