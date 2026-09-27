-- ============================================================================
-- Nerde.com — 001_init.sql
-- SQLite (node:sqlite / DatabaseSync). Table/column names pinned by CONTRACTS.md §5.
-- Amendments approved by orchestrator:
--   * events.client_id TEXT (nullable) — returning-user analytics
--   * slug_redirects table — old place/category slugs → canonical slug
-- ============================================================================

PRAGMA journal_mode = WAL;        -- persists in the DB file
PRAGMA foreign_keys = ON;         -- per-connection: also re-set on every open in db.ts

-- ── Accounts ────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                   -- scrypt$N$r$p$salt$hash (hex), node:crypto
  role          TEXT NOT NULL DEFAULT 'user',    -- user | admin
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,                   -- 256-bit random hex
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                       -- 30-day sessions; swept on login
);

-- ── Category system ─────────────────────────────────────────────────────────

CREATE TABLE categories (
  id    INTEGER PRIMARY KEY,
  slug  TEXT UNIQUE NOT NULL,                    -- kebab-case: 'calisthenics', 'arm-wrestling'
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT '📍',              -- emoji, rendered as marker badge
  color TEXT NOT NULL DEFAULT '#2563eb',         -- marker/chip color
  grp   TEXT NOT NULL DEFAULT 'outdoor',         -- fitness | outdoor
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE category_attributes (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  key         TEXT NOT NULL,                     -- snake_case: 'pull_up_bars'
  label       TEXT NOT NULL,                     -- UI label: 'Pull-up bars'
  type        TEXT NOT NULL,                     -- bool | enum | number | text
  options     TEXT,                              -- JSON array, enum only: '["outdoor","indoor"]'
  filterable  INTEGER NOT NULL DEFAULT 0,        -- 1 → shown as a filter chip
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, key)
);

-- ── Places ──────────────────────────────────────────────────────────────────

CREATE TABLE places (
  id               INTEGER PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,         -- slugified name + short id: 'macka-park-a3f9'
  name             TEXT NOT NULL,                -- validated 2–80 chars
  description      TEXT NOT NULL DEFAULT '',
  lat              REAL NOT NULL,                -- WGS84, validated [-90, 90]
  lng              REAL NOT NULL,                -- WGS84, validated [-180, 180]
  address          TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  region           TEXT NOT NULL DEFAULT '',
  country          TEXT NOT NULL DEFAULT '',
  country_code     TEXT NOT NULL DEFAULT '',     -- ISO 3166-1 alpha-2
  attrs            TEXT NOT NULL DEFAULT '{}',   -- JSON {"calisthenics.pull_up_bars":true,...}
  status           TEXT NOT NULL DEFAULT 'published',  -- published | pending | removed
  source           TEXT NOT NULL DEFAULT 'community',  -- community | osm | curated
  source_ref       TEXT,                         -- 'osm:node/123' — UNIQUE when not null
  created_by       INTEGER REFERENCES users(id), -- NULL for imports/system rows
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- denormalized verification cache (source of truth = verifications log)
  last_verified_at TEXT,                         -- set by 'confirm' votes only
  confirm_count    INTEGER NOT NULL DEFAULT 0,
  issue_count      INTEGER NOT NULL DEFAULT 0
);

-- Idempotent OSM import anchor: one row per external object, NULLs exempt.
CREATE UNIQUE INDEX places_source_ref ON places(source_ref) WHERE source_ref IS NOT NULL;
-- Geo: two-range bbox scans (lat range via index, lng filtered within the range).
CREATE INDEX places_lat_lng ON places(lat, lng);
-- Every public query filters status = 'published'.
CREATE INDEX places_status ON places(status);

-- Many-to-many places ↔ categories. PK serves place→categories; pc_cat category→places.
CREATE TABLE place_categories (
  place_id    INTEGER NOT NULL REFERENCES places(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY (place_id, category_id)
);
CREATE INDEX pc_cat ON place_categories(category_id, place_id);

-- ── Place content & community ───────────────────────────────────────────────

CREATE TABLE photos (
  id         INTEGER PRIMARY KEY,
  place_id   INTEGER NOT NULL REFERENCES places(id),
  url        TEXT NOT NULL,                      -- '/uploads/<random>.jpg'
  width      INTEGER,
  height     INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  place_id   INTEGER NOT NULL REFERENCES places(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, place_id)
);

-- Append-only event log; places.confirm_count/issue_count are a derived cache.
CREATE TABLE verifications (
  id         INTEGER PRIMARY KEY,
  place_id   INTEGER NOT NULL REFERENCES places(id),
  user_id    INTEGER REFERENCES users(id),       -- nullable for forward compat
  type       TEXT NOT NULL,                      -- confirm | issue
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reports (
  id         INTEGER PRIMARY KEY,
  place_id   INTEGER NOT NULL REFERENCES places(id),
  user_id    INTEGER REFERENCES users(id),       -- NULL → anonymous report
  reason     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',       -- open | resolved | dismissed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY,
  place_id   INTEGER NOT NULL REFERENCES places(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,                      -- validated 1–500 chars
  status     TEXT NOT NULL DEFAULT 'published',  -- published | removed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- First-party product analytics. No IPs, no PII, no precise device location.
-- Amendment: client_id — anonymous returning-user id generated by the client.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,                      -- whitelisted in server/routes/events.ts
  user_id    INTEGER,                            -- NULL → anonymous; NOT a hard FK
  client_id  TEXT,                               -- amendment: returning-user analytics
  meta       TEXT NOT NULL DEFAULT '{}',         -- JSON: {"category":"calisthenics",...}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Slug redirects (amendment) ──────────────────────────────────────────────
-- When a place/category slug changes (admin tooling, merge), the old slug keeps
-- resolving: GET /api/places/:slug answers 200 + canonical_slug.

CREATE TABLE slug_redirects (
  old_slug TEXT PRIMARY KEY,
  new_slug TEXT NOT NULL,
  kind     TEXT NOT NULL DEFAULT 'place'         -- place | category
);
