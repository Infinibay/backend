describe('Simple Test', () => {
  it('should pass', () => {
    expect(1 + 1).toBe(2)
  })

  it('should use mocked Prisma', () => {
    const { mockPrisma } = require('./setup/jest.setup')
    expect(mockPrisma).toBeDefined()
  })
})
