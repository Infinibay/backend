import * as yaml from 'js-yaml'
import { parseInstallSources, selectInstallSource } from '../../../../app/services/install/installSources'

// The REAL 26.04 Desktop shape: a TOP-LEVEL OBJECT with a `sources` array. The
// minimized desktop is marked default:true; the full desktop is default:false.
const DESKTOP_2604_OBJECT = yaml.dump({
  kernel: { default: 'linux-generic-hwe-24.04' },
  version: 2,
  sources: [
    { id: 'ubuntu-desktop-minimal', default: true, variant: 'desktop', type: 'fsimage-layered', path: 'minimal.squashfs', size: 6484422656, name: { en: 'Ubuntu Desktop (minimized)' }, description: { en: 'A minimal but usable Ubuntu Desktop.' } },
    { id: 'ubuntu-desktop', default: false, variant: 'desktop', type: 'fsimage-layered', path: 'minimal.standard.squashfs', size: 8248336384, name: { en: 'Ubuntu Desktop' }, description: { en: 'A full featured Ubuntu Desktop.' } }
  ]
})

// The REAL 24.04 Server shape: a TOP-LEVEL ARRAY.
const SERVER_2404_ARRAY = yaml.dump([
  { id: 'ubuntu-server-minimal', default: false, variant: 'server', type: 'fsimage', path: 'ubuntu-server-minimal.squashfs' },
  { id: 'ubuntu-server', default: true, variant: 'server', type: 'fsimage-layered', path: 'ubuntu-server-minimal.ubuntu-server.squashfs' }
])

describe('parseInstallSources', () => {
  it('parses the 26.04 OBJECT shape { sources: [...] } (regression: the old array-only parser returned [] here → minimized desktop)', () => {
    const sources = parseInstallSources(DESKTOP_2604_OBJECT)
    expect(sources.map(s => s.id)).toEqual(['ubuntu-desktop-minimal', 'ubuntu-desktop'])
    const full = sources.find(s => s.id === 'ubuntu-desktop')!
    expect(full.variant).toBe('desktop')
    expect(full.minimal).toBe(false)
    expect(full.path).toBe('minimal.standard.squashfs')
    expect(sources.find(s => s.id === 'ubuntu-desktop-minimal')!.minimal).toBe(true)
  })

  it('parses the 24.04 ARRAY shape', () => {
    const sources = parseInstallSources(SERVER_2404_ARRAY)
    expect(sources.map(s => s.id)).toEqual(['ubuntu-server-minimal', 'ubuntu-server'])
    expect(sources.find(s => s.id === 'ubuntu-server')!.variant).toBe('server')
  })

  it('returns [] for empty / unparseable / non-source input (caller falls back to ISO default)', () => {
    expect(parseInstallSources('')).toEqual([])
    expect(parseInstallSources('::: not yaml :::')).toEqual([])
    expect(parseInstallSources(yaml.dump({ kernel: {}, version: 2 }))).toEqual([])
    expect(parseInstallSources(yaml.dump([{ nope: 1 }]))).toEqual([])
  })

  it('derives minimal SEMANTICALLY from id + name + description (survives an id without the word "minimal")', () => {
    const sources = parseInstallSources(yaml.dump({
      sources: [
        { id: 'ubuntu-desktop-lite', variant: 'desktop', name: { en: 'Ubuntu Desktop (minimized)' } },
        { id: 'ubuntu-desktop', variant: 'desktop' }
      ]
    }))
    expect(sources.find(s => s.id === 'ubuntu-desktop-lite')!.minimal).toBe(true)
    expect(sources.find(s => s.id === 'ubuntu-desktop')!.minimal).toBe(false)
  })
})

describe('selectInstallSource', () => {
  it('desktop request on 26.04 → the FULL ubuntu-desktop, NOT the default:true minimized one', () => {
    const sources = parseInstallSources(DESKTOP_2604_OBJECT)
    const sel = selectInstallSource(sources, { preferredId: 'ubuntu-desktop', expectedEdition: 'desktop' })
    expect(sel?.id).toBe('ubuntu-desktop')
  })

  it('server request on 24.04 → ubuntu-server (default, non-minimal), never a desktop id', () => {
    const sources = parseInstallSources(SERVER_2404_ARRAY)
    const sel = selectInstallSource(sources, { expectedEdition: 'server' })
    expect(sel?.id).toBe('ubuntu-server')
  })

  it('survives a RENAMED full-desktop id + a misleading default:true on the minimal one', () => {
    // Future ISO: full source renamed 'ubuntu-desktop-full', minimal flipped to default:true,
    // and the profile's preferredId ('ubuntu-desktop') no longer exists.
    const sources = parseInstallSources(yaml.dump({
      sources: [
        { id: 'ubuntu-desktop-minimal', default: true, variant: 'desktop', size: 6000000000, name: { en: 'minimized' } },
        { id: 'ubuntu-desktop-full', default: false, variant: 'desktop', size: 9000000000, name: { en: 'A full featured Ubuntu Desktop.' } }
      ]
    }))
    const sel = selectInstallSource(sources, { preferredId: 'ubuntu-desktop', expectedEdition: 'desktop' })
    expect(sel?.id).toBe('ubuntu-desktop-full')
    expect(sel?.minimal).toBe(false)
  })

  it('does NOT collapse to the minimized desktop even when variant is MISSING (minimal-semantic exclusion)', () => {
    const sources = parseInstallSources(yaml.dump({
      sources: [
        { id: 'ubuntu-desktop-minimal', default: true, name: { en: 'minimized' } },
        { id: 'ubuntu-desktop', default: false }
      ]
    }))
    const sel = selectInstallSource(sources, { preferredId: 'ubuntu-desktop', expectedEdition: 'desktop' })
    expect(sel?.id).toBe('ubuntu-desktop')
  })

  it('minimal-only desktop ISO → returns the minimized source (best effort; caller warns)', () => {
    const sources = parseInstallSources(yaml.dump({
      sources: [{ id: 'ubuntu-desktop-minimal', default: true, variant: 'desktop', name: { en: 'minimized' } }]
    }))
    const sel = selectInstallSource(sources, { expectedEdition: 'desktop' })
    expect(sel?.id).toBe('ubuntu-desktop-minimal')
  })

  it('empty sources → undefined (caller omits `source`, subiquity uses ISO default)', () => {
    expect(selectInstallSource([], { expectedEdition: 'desktop' })).toBeUndefined()
  })
})
