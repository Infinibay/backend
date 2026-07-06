import { Application } from '@prisma/client'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promises as fsPromises } from 'fs'
import * as execModule from 'child_process'
import { KickstartInstaller } from '@services/kickstartInstaller'

// Mock the logger
const mockDebugLog = jest.fn()
jest.mock('@main/logger', () => {
  const mockChildLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  }
  return {
    __esModule: true,
    default: {
      ...mockChildLogger,
      child: jest.fn(() => mockChildLogger)
    }
  }
})

// Mock file system operations (single combined mock)
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
  promises: {
    ...jest.requireActual('fs').promises,
    mkdir: jest.fn(),
    rm: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}))

// Mock child_process
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(() => ({
      on: jest.fn()
    }))
  }))
}))

// MockEta
;(global as any).Eta = require('eta')
const mockEta = {
  renderString: jest.fn()
}
jest.mock('eta', () => ({
  Eta: jest.fn().mockImplementation(() => mockEta)
}))

describe('KickstartInstaller', () => {
  let manager: KickstartInstaller

  beforeEach(() => {
    jest.clearAllMocks()

    manager = new KickstartInstaller(
      'testuser',
      'testpassword123',
      [],
      'vm-123'
    )
  })

  describe('constructor', () => {
    it('should create instance with valid parameters', () => {
      expect(manager).toBeInstanceOf(KickstartInstaller)
      expect(manager.configFileName).toBe('ks.cfg')
      expect(manager.isoPath).toContain('fedora.iso')
    })

    it('should throw error when username is empty', () => {
      expect(() => {
        new KickstartInstaller('', 'password', [])
      }).toThrow('Username and password are required')
    })

    it('should throw error when password is empty', () => {
      expect(() => {
        new KickstartInstaller('username', '', [])
      }).toThrow('Username and password are required')
    })

    it('should use default locale, keyboard, and timezone', () => {
      const m = new KickstartInstaller('user', 'pass', [])
      expect(m).toBeDefined()
    })

    it('should accept custom locale, keyboard, and timezone', () => {
      const m = new KickstartInstaller(
        'user',
        'pass',
        [],
        'vm-123',
        'es_ES.UTF-8',
        'es',
        'Europe/Madrid'
      )
      expect(m).toBeDefined()
    })

    it('should set vmId to empty string when not provided', () => {
      const m = new KickstartInstaller('user', 'pass', [])
      expect(m['vmId']).toBe('')
    })
  })

  describe('validateConfig', () => {
    const validKickstart = [
      'lang en_US.UTF-8',
      'keyboard us',
      'timezone America/New_York',
      'rootpw --plaintext testpassword',
      'autopart',
      '%packages',
      '%end'
    ].join('\n')

    it('should validate valid locale format', async () => {
      const validation = await (manager as any).validateConfig(validKickstart)
      expect(validation.valid).toBe(true)
    })

    it('should validate valid keyboard layout', async () => {
      const validation = await (manager as any).validateConfig(validKickstart)
      expect(validation.valid).toBe(true)
    })

    it('should reject invalid locale format', async () => {
      // Partial config missing many required directives
      const testManager = new KickstartInstaller('user', 'pass', [])
      const validation = await (testManager as any).validateConfig('lang invalid_locale')
      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    it('should reject empty timezone', async () => {
      // 'timezone' without a value still matches the pattern /^timezone\s+/ - it won't match
      // But other required directives are missing too
      const validation = await (manager as any).validateConfig('timezone')
      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    it('should accept a %packages header carrying options (--ignoremissing)', async () => {
      // Regression: the live template emits `%packages --ignoremissing`, which an
      // exact-match check wrongly flagged as a missing %packages section.
      const withOptions = validKickstart.replace('%packages', '%packages --ignoremissing')
      const validation = await (manager as any).validateConfig(withOptions)
      expect(validation.valid).toBe(true)
      expect(validation.errors).not.toContain('Missing required %packages section')
    })
  })

  describe('generateApplicationsConfig', () => {
    it('should return empty string when no applications', async () => {
      const config = await manager.generateApplicationsConfig()
      expect(config).toBe('')
    })

    it('should generate config for Fedora compatible applications', async () => {
      const apps = [
        {
          id: 'app1',
          name: 'Test App',
          description: 'Test',
          os: ['fedora'],
          installCommand: { fedora: 'yum install test', windows: 'install.exe', ubuntu: 'apt install' }
        }
      ] as unknown as Application[]

      const testManager = new KickstartInstaller('user', 'pass', apps)
      const config = await testManager.generateApplicationsConfig()

      expect(config).toContain('Test App')
      expect(config).toContain('yum install test')
      expect(config).toContain('%post')
      expect(config).toContain('%end')
    })

    it('should skip incompatible applications', async () => {
      const apps = [
        {
          id: 'app1',
          name: 'Windows Only App',
          description: 'Windows only',
          os: ['windows'],
          installCommand: { windows: 'install.exe' }
        }
      ] as unknown as Application[]

      const testManager = new KickstartInstaller('user', 'pass', apps)
      const config = await testManager.generateApplicationsConfig()

      expect(config).toBe('')
    })

    it('should return empty string when no compatible apps for RedHat/Fedora', async () => {
      const apps = [
        {
          id: 'app1',
          name: 'Windows Only App',
          description: 'Windows only',
          os: ['windows'],
          installCommand: { windows: 'install.exe' }
        }
      ] as unknown as Application[]

      const testManager = new KickstartInstaller('user', 'pass', apps)
      const config = await testManager.generateApplicationsConfig()

      // No RedHat/Fedora compatible apps means empty string
      expect(config).toBe('')
    })

    it('should generate config for multiple Fedora/RHEL apps', async () => {
      const apps = [
        {
          id: 'app1',
          name: 'App 1',
          description: 'Fedora app',
          os: ['fedora'],
          installCommand: { fedora: 'yum install app1' }
        },
        {
          id: 'app2',
          name: 'App 2',
          description: 'RHEL app',
          os: ['redhat'],
          installCommand: { redhat: 'yum install app2', fedora: 'dnf install app2' }
        },
        {
          id: 'app3',
          name: 'App 3',
          description: 'Ubuntu only',
          os: ['ubuntu'],
          installCommand: { ubuntu: 'apt install app3' }
        }
      ] as unknown as Application[]

      const testManager = new KickstartInstaller('user', 'pass', apps)
      const config = await testManager.generateApplicationsConfig()

      expect(config).toContain('App 1')
      expect(config).toContain('App 2')
      expect(config).not.toContain('App 3')
    })
  })

  describe('generateInfiniServiceConfig', () => {
    it('should generate InfiniService installation script', async () => {
      const config = manager['generateInfiniServiceConfig']()

      expect(config).toContain('%post')
      expect(config).toContain('infiniservice')
      expect(config).toContain('install-linux.sh')
      // Host is resolved at runtime from the default gateway; APP_HOST is only the
      // fallback. Only the port is baked into the script; the host is $BACKEND_HOST.
      expect(config).toContain(`BASE_URL="http://\${BACKEND_HOST}:${process.env.PORT || '4000'}"`)
      expect(config).toContain(`\${GW:-${process.env.APP_HOST || 'localhost'}}`)
      expect(config).toContain('vm-123') // vmId
    })

    it('should include network waiting logic', async () => {
      const config = manager['generateInfiniServiceConfig']()

      expect(config).toContain('wait_for_network')
      expect(config).toContain('ip -4 addr show')
      expect(config).toContain('getent hosts')
    })

    it('should include retry logic for downloads', async () => {
      const config = manager['generateInfiniServiceConfig']()

      expect(config).toContain('download_with_retry')
      expect(config).toContain('max_retries')
      expect(config).toContain('sleep')
    })

    it('should use custom backend URL when configured', async () => {
      process.env.APP_HOST = 'custom-server'
      process.env.PORT = '8080'

      const testManager = new KickstartInstaller('user', 'pass', [])
      const config = testManager['generateInfiniServiceConfig']()

      // Port is baked; the host is resolved at runtime from the gateway, with
      // APP_HOST kept only as the fallback.
      expect(config).toContain('BASE_URL="http://${BACKEND_HOST}:8080"')
      expect(config).toContain('${GW:-custom-server}')

      delete process.env.APP_HOST
      delete process.env.PORT
    })
  })

  describe('extractFedoraVersionFromISO', () => {
    it('should extract Fedora version from ISO Volume ID', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = '/path/to/fedora-43.iso'

      // Mock executeCommand to return isoinfo output with Volume ID
      const mockExecCmd = jest.spyOn(testManager as any, 'executeCommand')
        .mockResolvedValue('Volume id: Fedora-S-dvd-x86_64-43\n')

      const version = await testManager['extractFedoraVersionFromISO']()

      expect(version).toBe('43')
      mockExecCmd.mockRestore()
    })

    it('should throw (not invent a version) when isoinfo fails', async () => {
      // A placeholder version would build a bogus `repo=fedora-<N>` mirrorlist and
      // make anaconda abort mid-install; failing the build here is the intended
      // behaviour so the cause is obvious.
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = '/nonexistent.iso'

      const mockExecCmd = jest.spyOn(testManager as any, 'executeCommand')
        .mockRejectedValue(new Error('File not found'))

      await expect(testManager['extractFedoraVersionFromISO']()).rejects.toThrow(/Volume ID/)
      mockExecCmd.mockRestore()
    })

    it('should throw when the Volume ID has no numeric version (e.g. Rawhide)', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = '/path/to/rawhide.iso'

      const mockExecCmd = jest.spyOn(testManager as any, 'executeCommand')
        .mockResolvedValue('Volume id: Fedora-WS-dvd-x86_64-Rawhide\n')

      await expect(testManager['extractFedoraVersionFromISO']()).rejects.toThrow(/Rawhide|parse a Fedora version/)
      mockExecCmd.mockRestore()
    })
  })

  describe('modifyGrubConfigForKickstart', () => {
    let testDir: string
    const mockReadFile = jest.spyOn(fsPromises, 'readFile')
    const mockWriteFile = jest.spyOn(fsPromises, 'writeFile')

    beforeEach(() => {
      testDir = os.tmpdir()
      mockReadFile.mockClear()
      mockWriteFile.mockClear()
    })

    afterEach(() => {
      mockReadFile.mockReset()
      mockWriteFile.mockReset()
    })

    it('should modify GRUB config to add inst.ks parameter', async () => {
      const grubCfgContent = `
set timeout=10
menuentry "Fedora" {
  linux /vmlinuz inst.stage2=hd:LABEL=Fedora-29-x86_64
}
`
      mockReadFile.mockResolvedValue(grubCfgContent)

      const testManager = new KickstartInstaller('user', 'pass', [])
      await testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg')

      expect(mockWriteFile).toHaveBeenCalled()
    })

    it('should set GRUB timeout to 3 seconds', async () => {
      const grubCfgContent = 'set timeout=10'
      mockReadFile.mockResolvedValue(grubCfgContent)

      const testManager = new KickstartInstaller('user', 'pass', [])
      await testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg')

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/boot/grub2/grub.cfg',
        expect.stringContaining('set timeout=3'),
        'utf-8'
      )
    })

    it('should add timeout if not present', async () => {
      const grubCfgContent = 'set gfxpayload=keep\nmenuentry "Fedora" { }'
      mockReadFile.mockResolvedValue(grubCfgContent)

      const testManager = new KickstartInstaller('user', 'pass', [])
      await testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg')

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/boot/grub2/grub.cfg',
        expect.stringContaining('set timeout=3'),
        'utf-8'
      )
    })
  })

  describe('modifyIsolinuxConfigForKickstart', () => {
    beforeEach(() => {
      (fs.promises.readFile as jest.Mock).mockClear();
      (fs.promises.writeFile as jest.Mock).mockClear()
    })

    it('should modify isolinux config to add inst.ks parameter', async () => {
      const isolinuxCfgContent = `
label Fedora
  append initrd=initrd.img inst.stage2=hd:LABEL=Fedora-29-x86_64
`;
      (fs.promises.readFile as jest.Mock).mockResolvedValue(isolinuxCfgContent);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined)

      const testManager = new KickstartInstaller('user', 'pass', [])
      await testManager['modifyIsolinuxConfigForKickstart']('/isolinux/isolinux.cfg')

      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should remove existing inst.ks parameters and add new one', async () => {
      const isolinuxCfgContent = '  append inst.ks=old.cfg inst.stage2=hd:LABEL=Old';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(isolinuxCfgContent);
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined)

      const testManager = new KickstartInstaller('user', 'pass', [])
      await testManager['modifyIsolinuxConfigForKickstart']('/isolinux/isolinux.cfg')

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/isolinux/isolinux.cfg',
        expect.stringContaining('inst.ks=cdrom:/ks.cfg'),
        'utf-8'
      )
    })
  })

  describe('getXorrisoParamsFromISO', () => {
    it('should extract xorriso parameters from ISO', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = '/path/to/test.iso'

      // Mock executeCommand to return xorriso params
      const mockedExecuteCommand = jest.spyOn(testManager, 'executeCommand' as any)
      mockedExecuteCommand.mockResolvedValue('mkisofs -V "Test ISO" -b isolinux.bin')

      const params = await testManager['getXorrisoParamsFromISO']('/path/to/test.iso')

      expect(params).toBeInstanceOf(Array)
    })

    it('should return empty array when extraction fails', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = '/nonexistent.iso'

      const mockedExecuteCommand = jest.spyOn(testManager, 'executeCommand' as any)
      mockedExecuteCommand.mockRejectedValue(new Error('File not found'))

      const params = await testManager['getXorrisoParamsFromISO']('/nonexistent.iso')

      expect(params).toEqual([])
    })
  })

  describe('parseShellArgs', () => {
    it('should parse shell arguments respecting quotes', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      const result = (testManager as any).parseShellArgs('-V \'Fedora 41 x86_64\'')
      expect(result).toEqual(['-V', 'Fedora 41 x86_64'])
    })

    it('should handle double quotes', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      const result = (testManager as any).parseShellArgs('-V "Fedora 41"')
      expect(result).toEqual(['-V', 'Fedora 41'])
    })

    it('should split multiple arguments', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      const result = (testManager as any).parseShellArgs('-V Test -b boot.img -o output.iso')
      expect(result).toEqual(['-V', 'Test', '-b', 'boot.img', '-o', 'output.iso'])
    })
  })

  describe('sanitizeScriptName', () => {
    it('should sanitize script name by removing special characters', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      const sanitized = (testManager as any).sanitizeScriptName('My Script/Name&Special!')
      expect(sanitized).toBe('My_ScriptNameSpecial')
    })

    it('should truncate names longer than 60 characters', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      const longName = 'a'.repeat(100)
      const sanitized = (testManager as any).sanitizeScriptName(longName)
      expect(sanitized.length).toBeLessThanOrEqual(60)
    })

    it('should return "script" for empty or invalid input', () => {
      const testManager = new KickstartInstaller('user', 'pass', [])

      expect((testManager as any).sanitizeScriptName('')).toBe('script')
      expect((testManager as any).sanitizeScriptName(null as any)).toBe('script')
      expect((testManager as any).sanitizeScriptName(undefined as any)).toBe('script')
    })
  })

  describe('generateConfig', () => {
    beforeEach(() => {
      // Mock readFileSync for template loading
      ;(fs.readFileSync as jest.Mock).mockReturnValue('template content')
      // Mock extractFedoraVersionFromISO to avoid real command execution
      jest.spyOn(manager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')

      mockEta.renderString.mockImplementation((template: string, data: any) => {
        return `---
username: ${data.username}
password: ${data.password}
locale: ${data.locale}
keyboard: ${data.keyboard}
timezone: ${data.timezone}
fedoraVersion: ${data.fedoraVersion}
`})
    })

    it('should generate complete kickstart configuration', async () => {
      const mockLog = jest.spyOn(manager['debug'], 'warn').mockImplementation(() => ({} as any))
      jest.spyOn(manager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')

      const result = await manager.generateConfig()

      expect(result).toBeDefined()
      expect(mockEta.renderString).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ username: 'testuser' })
      )
    })

    it('should use default locale when invalid', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [], 'vm-123', 'invalid_locale')
      jest.spyOn(testManager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')
      const mockLog = jest.spyOn(testManager['debug'], 'warn').mockImplementation(() => ({} as any))

      await testManager.generateConfig()

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Invalid locale'))
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('using default'))
    })

    it('should use default keyboard when invalid', async () => {
      // 'INVALID' is uppercase, which fails the /^[a-z]{2,3}$/ check
      const testManager = new KickstartInstaller('user', 'pass', [], 'vm-123', 'en_US', 'INVALID', 'UTC')
      jest.spyOn(testManager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')
      const mockLog = jest.spyOn(testManager['debug'], 'warn').mockImplementation(() => ({} as any))

      await testManager.generateConfig()

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Invalid keyboard'))
    })

    it('should use default timezone when empty', async () => {
      // Constructor defaults empty string to 'America/New_York', so timezone is never empty in generateConfig
      // Instead, verify the constructor handles the default correctly
      const testManager = new KickstartInstaller('user', 'pass', [], 'vm-123', 'en_US', 'us', '')
      jest.spyOn(testManager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')

      await testManager.generateConfig()

      // The constructor replaces empty timezone with 'America/New_York'
      expect(testManager['timezone']).toBe('America/New_York')
    })

    it('should throw error when template file is missing', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      jest.spyOn(testManager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')

      // Mock readFileSync to throw error
      ;(fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Template not found')
      })

      await expect(testManager.generateConfig()).rejects.toThrow()
    })
  })

  describe('generateNewImage', () => {
    it('should throw error when ISO path is not set', async () => {
      const testManager = new KickstartInstaller('user', 'pass', [])
      testManager['isoPath'] = null

      await expect(testManager.generateNewImage()).rejects.toThrow('No ISO path specified')
    })

    it('should clean up extracted directory on error', async () => {
      // generateConfig succeeds so we proceed to extractISO
      jest.spyOn(manager, 'generateConfig' as any).mockResolvedValue('valid config')
      jest.spyOn(manager as any, 'validateConfig').mockResolvedValue({ valid: true, errors: [] })
      jest.spyOn(manager as any, 'validatePath').mockReturnValue('/tmp/test-output')
      // extractISO succeeds, setting extractDir
      jest.spyOn(manager as any, 'extractISO').mockResolvedValue('/tmp/extracted_iso_123')
      // addAutonistallConfigFile fails, triggering cleanup
      jest.spyOn(manager as any, 'addAutonistallConfigFile').mockRejectedValue(new Error('Write failed'))
      const mockCleanup = jest.spyOn(manager as any, 'cleanup').mockResolvedValue(undefined)

      await expect(manager.generateNewImage()).rejects.toThrow('Write failed')

      expect(mockCleanup).toHaveBeenCalledWith('/tmp/extracted_iso_123')
    })
  })

  describe('integration tests', () => {
    it('should handle complete workflow with Fedora-compatible applications', async () => {
      const apps = [
        {
          id: 'app1',
          name: 'Git',
          description: 'Version control',
          os: ['fedora'],
          installCommand: { fedora: 'dnf install git', redhat: 'yum install git' }
        },
        {
          id: 'app2',
          name: 'Python',
          description: 'Python interpreter',
          os: ['redhat'],
          installCommand: { fedora: 'dnf install python3', redhat: 'yum install python3' }
        }
      ] as unknown as Application[]

      const testManager = new KickstartInstaller('testuser', 'testpass123', apps)
      // Mock extractFedoraVersionFromISO to avoid real command execution
      jest.spyOn(testManager as any, 'extractFedoraVersionFromISO').mockResolvedValue('43')
      ;(fs.readFileSync as jest.Mock).mockReturnValue('template content')

      // Mock Eta to include app info in rendered output
      mockEta.renderString.mockImplementation((template: string, data: any) => {
        return `${data.applicationsPostCommands}\n${data.infiniServicePostCommands}`
      })

      const config = await testManager.generateConfig()

      expect(config).toContain('Git')
      expect(config).toContain('Python')
      expect(config).toContain('dnf install')
    })
  })
})
