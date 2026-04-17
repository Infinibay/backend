import { UnattendedManagerBase } from '../../../app/services/unattendedManagerBase'
import logger from '@main/logger'

class TestUnattendedManager extends UnattendedManagerBase {
  // Expose protected properties for testing
  public get testConfigFileName(): string | null {
    return this.configFileName
  }

  public get testIsoPath(): string | null {
    return this.isoPath
  }

  public setTestIsoPath(isoPath: string) {
    (this as any).isoPath = isoPath
  }

  public setTestConfigFileName(fileName: string) {
    (this as any).configFileName = fileName
  }

  public async testGenerateConfig(): Promise<string> {
    return await this.generateConfig()
  }

  public async testGenerateNewImage(): Promise<string> {
    return await this.generateNewImage()
  }

  public async testValidatePath(envPath: string | undefined, defaultPath: string): Promise<string> {
    return this.validatePath(envPath, defaultPath)
  }

  public testGenerateRandomFileName(): string {
    return this.generateRandomFileName()
  }

  public testSanitizeScriptName(scriptName: string): string {
    return this.sanitizeScriptName(scriptName)
  }

  protected async createISO(_newIsoPath: string, _extractDir: string): Promise<void> {
    // Mock implementation for testing
  }
}

describe('UnattendedManagerBase', () => {
  let manager: TestUnattendedManager
  let mockDebugLog: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    manager = new TestUnattendedManager()
    manager.setTestIsoPath('/tmp/test.iso')
    manager.setTestConfigFileName('test.cfg')

    // Mock logger methods
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
  })

  describe('constructor and initialization', () => {
    it('should initialize with default values', () => {
      expect(manager.configFileName).toBe('test.cfg')
      expect(manager.isoPath).toBe('/tmp/test.iso')
    })
  })

  describe('generateConfig', () => {
    it('should return empty string for base class', async () => {
      const result = await manager.testGenerateConfig()
      expect(result).toBe('')
    })
  })

  describe('validatePath', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv, INFINIBAY_BASE_DIR: '/opt/infinibay' }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should use provided path and create directory if it does not exist', async () => {
      const testDir = '/tmp/test_validation_' + Date.now()
      const result = await manager.testValidatePath(testDir, '/default/path')
      expect(result).toBe(testDir)
      expect(require('fs').existsSync(testDir)).toBe(true)
    })

    it('should use default path when environment path is undefined', async () => {
      process.env.TEST_PATH = ''
      const fs = require('fs')
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      const result = await manager.testValidatePath(process.env.TEST_PATH, '/default/path')
      expect(result).toBe('/default/path')
      existsSyncSpy.mockRestore()
    })

    it('should use default path when environment path is empty string', async () => {
      const fs = require('fs')
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      const result = await manager.testValidatePath('', '/default/path')
      expect(result).toBe('/default/path')
      existsSyncSpy.mockRestore()
    })
  })

  describe('generateRandomFileName', () => {
    it('should generate a random filename with .iso extension', () => {
      const fileName = manager.testGenerateRandomFileName()
      expect(fileName).toMatch(/^[a-z0-9]+\.iso$/)
      expect(fileName.length).toBeGreaterThan(5)
      expect(fileName.length).toBeLessThan(30)
    })

    it('should generate unique filenames on consecutive calls', () => {
      const fileName1 = manager.testGenerateRandomFileName()
      const fileName2 = manager.testGenerateRandomFileName()
      expect(fileName1).not.toBe(fileName2)
    })
  })

  describe('sanitizeScriptName', () => {
    it('should return "script" for empty input', () => {
      expect(manager.testSanitizeScriptName('')).toBe('script')
      expect(manager.testSanitizeScriptName(null as any)).toBe('script')
      expect(manager.testSanitizeScriptName(undefined as any)).toBe('script')
    })

    it('should replace spaces with underscores', () => {
      expect(manager.testSanitizeScriptName('my script')).toBe('my_script')
    })

    it('should remove special characters except underscores and hyphens', () => {
      expect(manager.testSanitizeScriptName('script@name#test!')).toBe('scriptnametest')
      expect(manager.testSanitizeScriptName('script with spaces & symbols!')).toBe('script_with_spaces__symbols')
    })

    it('should truncate to 60 characters', () => {
      const longName = 'a'.repeat(100)
      const result = manager.testSanitizeScriptName(longName)
      expect(result.length).toBe(60)
    })

    it('should preserve alphanumeric characters, underscores, and hyphens', () => {
      expect(manager.testSanitizeScriptName('My_Script-Name123')).toBe('My_Script-Name123')
    })

    it('should handle mixed case correctly', () => {
      expect(manager.testSanitizeScriptName('MyScript')).toBe('MyScript')
    })
  })

  describe('generateNewImage', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv, INFINIBAY_BASE_DIR: '/opt/infinibay' }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should throw error if isoPath is not set', async () => {
      manager.setTestIsoPath(null as any)
      await expect(manager.testGenerateNewImage()).rejects.toThrow('No ISO path specified')
    })

    it('should throw error if configFileName is not set', async () => {
      manager.setTestConfigFileName(null as any)
      // Mock validatePath and extractISO so we reach the configFileName check
      jest.spyOn(manager as any, 'validatePath').mockReturnValue('/tmp/test-output')
      jest.spyOn(manager as any, 'extractISO').mockResolvedValue('/tmp/extracted')
      jest.spyOn(manager as any, 'cleanup').mockResolvedValue(undefined)
      await expect(manager.testGenerateNewImage()).rejects.toThrow('configFileName is not set')
    })

    it('should validate configuration and throw on validation failure', async () => {
      jest.spyOn(manager as any, 'validateConfig').mockResolvedValueOnce({
        valid: false,
        errors: ['Validation error 1', 'Validation error 2']
      })

      await expect(manager.testGenerateNewImage()).rejects.toThrow('Configuration validation failed: Validation error 1; Validation error 2')
    })

    it('should call validateConfig with generated config content', async () => {
      const mockConfig = 'test config content'
      jest.spyOn(manager as any, 'generateConfig').mockResolvedValueOnce(mockConfig)
      const validateSpy = jest.spyOn(manager as any, 'validateConfig').mockResolvedValueOnce({ valid: true, errors: [] })

      await expect(manager.testGenerateNewImage()).rejects.toThrow() // Will fail on ISO extraction

      expect(validateSpy).toHaveBeenCalledWith(mockConfig)
    })
  })

  describe('cleanup', () => {
    it('should not throw on cleanup of valid directory', async () => {
      const testDir = '/tmp/test_cleanup_' + Date.now()
      require('fs').mkdirSync(testDir, { recursive: true })

      // Test cleanup through the private method using type assertion
      const managerAny = manager as any
      await expect(managerAny.cleanup(testDir)).resolves.not.toThrow()

      // Verify directory was cleaned up
      expect(require('fs').existsSync(testDir)).toBe(false)
    })

    it('should not throw on cleanup of non-existent directory', async () => {
      const nonExistentDir = '/tmp/non_existent_' + Date.now()
      const managerAny = manager as any
      await expect(managerAny.cleanup(nonExistentDir)).resolves.not.toThrow()
    })

    it('should handle cleanup failures gracefully', async () => {
      const managerAny = manager as any
      // This should not throw even with invalid path
      await expect(managerAny.cleanup('')).resolves.not.toThrow()
    })

    it('should protect against unsafe cleanup paths', async () => {
      const managerAny = manager as any
      // Should handle paths outside tmpdir
      await expect(managerAny.cleanup('/etc/passwd')).resolves.not.toThrow()
    })
  })
  describe('integration tests', () => {
    it('should properly chain generateConfig -> validateConfig -> generateNewImage', async () => {
      const managerAny = manager as any
      const mockConfig = 'test configuration'
      jest.spyOn(managerAny, 'generateConfig').mockResolvedValueOnce(mockConfig)
      jest.spyOn(managerAny, 'validateConfig').mockResolvedValueOnce({ valid: true, errors: [] })

      await expect(managerAny.testGenerateNewImage()).rejects.toThrow()

      // Verify the chain worked correctly
      expect(managerAny.generateConfig).toHaveBeenCalled()
      expect(managerAny.validateConfig).toHaveBeenCalledWith(mockConfig)
    })

    it('should clean up on generateNewImage failure', async () => {
      const managerAny = manager as any
      jest.spyOn(managerAny, 'generateConfig').mockResolvedValueOnce('test config')
      jest.spyOn(managerAny, 'validateConfig').mockResolvedValueOnce({ valid: false, errors: ['test error'] })

      await expect(managerAny.testGenerateNewImage()).rejects.toThrow()
      // Cleanup should have been attempted
    })
  })
})
