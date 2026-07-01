import { isoFileFilter } from '../../../app/routes/isoUpload'

// Silence the module logger (isoUpload imports @main/logger).
jest.mock('@main/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
}))

function run (originalname: string, mimetype?: string): { err: Error | null, accepted?: boolean } {
  let err: Error | null = null
  let accepted: boolean | undefined
  isoFileFilter({}, { originalname, mimetype }, (e, a) => { err = e; accepted = a })
  return { err, accepted }
}

describe('isoFileFilter', () => {
  it('accepts an .iso with the vnd.efi.iso MIME type (the reported upload failure)', () => {
    // This exact MIME rejected the Ubuntu Desktop upload before the fix.
    const { err, accepted } = run('ubuntu-26.04-desktop-amd64.iso', 'application/vnd.efi.iso')
    expect(err).toBeNull()
    expect(accepted).toBe(true)
  })

  it('accepts an .iso regardless of MIME — browsers report wildly varying types', () => {
    for (const mime of ['application/octet-stream', 'application/x-iso9660-image', 'weird/made-up', '', undefined]) {
      const { err, accepted } = run('some-distro.iso', mime as string | undefined)
      expect(err).toBeNull()
      expect(accepted).toBe(true)
    }
  })

  it('rejects a non-.iso file by extension (the real gate)', () => {
    const { err, accepted } = run('malware.exe', 'application/octet-stream')
    expect(err).toBeInstanceOf(Error)
    expect((err as unknown as Error).message).toMatch(/only \.iso/i)
    expect(accepted).toBeUndefined()
  })

  it('is case-insensitive on the extension', () => {
    const { err, accepted } = run('Ubuntu-Desktop.ISO', 'application/vnd.efi.iso')
    expect(err).toBeNull()
    expect(accepted).toBe(true)
  })
})
