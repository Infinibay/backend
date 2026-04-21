// Mock for uuid ESM module (uuid v14 is ESM-only and breaks Jest CJS)
let counter = 0

function mockUuid(): string {
  counter++
  // Return a valid UUID v4 format string so regex checks pass
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

export const v1 = mockUuid
export const v3 = mockUuid
export const v4 = mockUuid
export const v5 = mockUuid
export const v6 = mockUuid
export const v7 = mockUuid
export const NIL = '00000000-0000-0000-0000-000000000000'
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
export function parse(uuid: string) { return new Uint8Array(16) }
export function stringify(buf: Uint8Array) { return mockUuid() }
export function validate(uuid: string) { return true }
export function version(uuid: string) { return 4 }
