// Import the mocked Prisma at module level. Requiring the setup module from INSIDE
// a test re-registers its beforeAll/beforeEach hooks within the running test, which
// jest rejects ("Hooks cannot be defined inside tests").
import { mockPrisma } from './setup/jest.setup'

describe('Simple Test', () => {
  it('should pass', () => {
    expect(1 + 1).toBe(2)
  })

  it('should use mocked Prisma', () => {
    expect(mockPrisma).toBeDefined()
  })
})
