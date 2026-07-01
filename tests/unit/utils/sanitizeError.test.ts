import { sanitizeErrorForUser } from '../../../app/utils/sanitizeError'

describe('sanitizeErrorForUser', () => {
  it('reduces absolute host paths to their basename (hides host layout)', () => {
    const raw = "Unattended install ISO generation failed for windows11: ENOENT: no such file or directory, open '/opt/infinibay/isos/win11.iso' — ensure /usr/bin/7z and /usr/bin/xorriso are installed"
    const out = sanitizeErrorForUser(raw) as string
    expect(out).not.toContain('/opt/infinibay')
    expect(out).not.toContain('/usr/bin')
    // The useful basenames survive so the message stays actionable.
    expect(out).toContain('win11.iso')
    expect(out).toContain('7z')
    expect(out).toContain('xorriso')
  })

  it('collapses multi-line command stderr into a single line', () => {
    const raw = 'Command failed: ip link set vnet0 master infbr0\nstdout:\nstderr: Error: argument "infbr0" is wrong: Device does not exist\n'
    const out = sanitizeErrorForUser(raw) as string
    expect(out).not.toContain('\n')
    // Bridge name + kernel reason are not sensitive host paths — kept for context.
    expect(out).toContain('infbr0')
    expect(out).toContain('Device does not exist')
  })

  it('does NOT mangle a lone slash or word/word', () => {
    expect(sanitizeErrorForUser('use allow/deny policy')).toBe('use allow/deny policy')
  })

  it('caps very long messages', () => {
    const out = sanitizeErrorForUser('x'.repeat(1000)) as string
    expect(out.length).toBeLessThanOrEqual(300)
    expect(out.endsWith('…')).toBe(true)
  })

  it('passes through null/undefined unchanged (as null)', () => {
    expect(sanitizeErrorForUser(null)).toBeNull()
    expect(sanitizeErrorForUser(undefined)).toBeNull()
    expect(sanitizeErrorForUser('')).toBe('')
  })

  it('strips a leaked node internal path but keeps the semantic tail', () => {
    const raw = 'disk copy failed: /workspace/backend/node-2/disks/abc.qcow2 checksum mismatch'
    const out = sanitizeErrorForUser(raw) as string
    expect(out).not.toContain('/workspace')
    expect(out).toContain('abc.qcow2')
    expect(out).toContain('checksum mismatch')
  })
})
