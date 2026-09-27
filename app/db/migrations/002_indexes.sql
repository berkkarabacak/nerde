-- ============================================================================
-- Nerde.com — 002_indexes.sql
-- Additive secondary indexes recommended by DATABASE.md §6 for FK-join paths
-- (SQLite does not auto-index FK columns). Safe to run on an empty or seeded DB.
-- ============================================================================

CREATE INDEX IF NOT EXISTS photos_place ON photos(place_id);
CREATE INDEX IF NOT EXISTS comments_place ON comments(place_id);
CREATE INDEX IF NOT EXISTS verifications_place_user ON verifications(place_id, user_id);
CREATE INDEX IF NOT EXISTS favorites_place ON favorites(place_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS events_type_created ON events(type, created_at);

ANALYZE;
