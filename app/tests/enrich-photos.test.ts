// P1-11b Commons photo enrichment: unit tests for the pure helpers in
// scripts/enrich-photos.ts — license compatibility, winner selection order,
// and the description credit line. No DB, no network.
import { describe, expect, it } from 'vitest'
import { buildCreditLine, isCompatibleLicense, pickLicensedImage, stripHtml } from '../scripts/enrich-photos.ts'
import type { CommonsPage } from '../scripts/enrich-photos.ts'

describe('isCompatibleLicense (P1-11b)', () => {
  it('accepts CC0 / Public domain / CC BY / CC BY-SA (any version)', () => {
    for (const ok of ['CC0', 'CC0 1.0', 'Public domain', 'public domain', 'CC BY 4.0', 'CC BY 2.0', 'cc by 3.0', 'CC BY-SA 4.0', 'CC BY-SA 2.5']) {
      expect(isCompatibleLicense(ok), ok).toBe(true)
    }
  })

  it('rejects NC/ND/GFDL/unknown — the substring "CC BY" must not leak them in', () => {
    for (const no of ['CC BY-NC-SA 4.0', 'CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-ND 2.0', 'GFDL', 'Attribution', '', 'Copyrighted free use']) {
      expect(isCompatibleLicense(no), no).toBe(false)
    }
  })
})

describe('pickLicensedImage (P1-11b)', () => {
  const page = (index: number, license: string, title = `File:${index}.jpg`): CommonsPage => ({
    title,
    index,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/thumb/${index}.jpg`,
        thumbwidth: 800,
        thumbheight: 600,
        extmetadata: {
          LicenseShortName: { value: license },
          Artist: { value: `<a href="https://commons.wikimedia.org/wiki/User:jdoe">Jane Doe</a>` },
        },
      },
    ],
  })

  it('picks the first compatible image in geosearch (index) order, skipping NC', () => {
    const pick = pickLicensedImage([page(2, 'CC BY-NC 4.0'), page(1, 'CC BY-SA 4.0'), page(3, 'Public domain')])
    expect(pick?.title).toBe('File:1.jpg')
    expect(pick?.license).toBe('CC BY-SA 4.0')
    expect(pick?.artist).toBe('Jane Doe') // HTML stripped from Artist
    expect(pick?.width).toBe(800)
    expect(pick?.height).toBe(600)
  })

  it('returns null when nothing nearby is licensed compatibly or thumbed', () => {
    expect(pickLicensedImage([page(1, 'CC BY-NC-ND 2.0')])).toBeNull()
    expect(pickLicensedImage([{ title: 'File:none.jpg', index: 1 }])).toBeNull()
    expect(pickLicensedImage([])).toBeNull()
  })
})

describe('credit line (P1-11b)', () => {
  it('stripHtml removes tags and decodes the common entities', () => {
    expect(stripHtml('<b>Tom &amp; Ana</b>  <i>Jr.</i>')).toBe('Tom & Ana Jr.')
    expect(stripHtml('plain')).toBe('plain')
  })

  it('buildCreditLine matches the documented format', () => {
    expect(buildCreditLine('Jane Doe', 'CC BY-SA 4.0')).toBe('Photo: Jane Doe, CC BY-SA 4.0 via Wikimedia Commons.')
  })
})
