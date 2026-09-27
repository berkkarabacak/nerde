// Schema / migration tests: an empty DB must migrate cleanly and re-opening
// the same file must be a no-op (idempotent).
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanupTmp, freshDb } from './helpers.ts'
import { closeDb, getDb } from '../server/db.ts'

describe('schema & migrations', () => {
  afterAll(cleanupTmp)

  it('applies all migrations cleanly on an empty database', () => {
    const db = freshDb(false)
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    for (const t of [
      'users',
      'sessions',
      'categories',
      'category_attributes',
      'places',
      'place_categories',
      'photos',
      'favorites',
      'verifications',
      'reports',
      'comments',
      'events',
      'slug_redirects',
      'migrations',
    ]) {
      expect(tables).toContain(t)
    }
    const applied = db.prepare('SELECT name FROM migrations ORDER BY name').all() as Array<{ name: string }>
    expect(applied.map((r) => r.name)).toEqual(['001_init.sql', '002_indexes.sql', '003_oauth.sql'])
    // CONTRACTS §5 amendment: events.client_id exists.
    const eventCols = db.prepare(`PRAGMA table_info(events)`).all() as Array<{ name: string }>
    expect(eventCols.map((c) => c.name)).toContain('client_id')
    // 003_oauth.sql (approved additive exception, MVP_BACKLOG P1-01):
    // users.oauth_provider / oauth_sub + partial unique index.
    const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
    expect(userCols.map((c) => c.name)).toContain('oauth_provider')
    expect(userCols.map((c) => c.name)).toContain('oauth_sub')
    const oauthIndex = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'users_oauth'`)
      .get() as { name: string } | undefined
    expect(oauthIndex?.name).toBe('users_oauth')
  })

  it('003_oauth.sql: one OAuth identity links to exactly one account', () => {
    const db = freshDb(false)
    const ins = db.prepare(
      `INSERT INTO users (email, username, password_hash, oauth_provider, oauth_sub)
       VALUES (?, ?, 'x', 'google', ?)`,
    )
    ins.run('a@example.com', 'usera', 'g-1')
    ins.run('b@example.com', 'userb', null) // NULL subs are exempt (email+password accounts)
    ins.run('c@example.com', 'userc', null)
    expect(() => ins.run('d@example.com', 'userd', 'g-1')).toThrow() // duplicate identity rejected
  })

  it('is idempotent: closing and re-opening the same file applies nothing twice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerde-test-idem-'))
    process.env.NERDE_DB_PATH = path.join(dir, 'test.sqlite')
    closeDb()
    const first = getDb()
    first.prepare(`INSERT INTO categories (slug, name) VALUES ('calisthenics', 'Calisthenics Parks')`).run()
    closeDb()
    const second = getDb() // re-open same file — migrations must not re-run or fail
    const applied = second.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }
    expect(applied.c).toBe(3)
    const cat = second.prepare(`SELECT name FROM categories WHERE slug = 'calisthenics'`).get() as {
      name: string
    }
    expect(cat.name).toBe('Calisthenics Parks')
    closeDb()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('enforces the unique partial index on places.source_ref', () => {
    const db = freshDb(false)
    const ins = db.prepare(
      `INSERT INTO places (slug, name, lat, lng, source, source_ref) VALUES (?, 'P', 1, 1, 'osm', ?)`,
    )
    ins.run('p-aaaa', 'osm:node/1')
    ins.run('p-bbbb', null) // NULLs are exempt
    ins.run('p-cccc', null)
    expect(() => ins.run('p-dddd', 'osm:node/1')).toThrow() // duplicate source_ref rejected
  })
})
