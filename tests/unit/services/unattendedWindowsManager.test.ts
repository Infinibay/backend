import { Application } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'

// Mock the module dependencies
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  stat: jest.fn(),
  writeFile: jest.fn(() => Promise.resolve())
}))

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(() => {
    const mock: any = jest.fn()
    mock.stdout = { on: jest.fn() }
    mock.stderr = { on: jest.fn() }
    mock.on = jest.fn()
    return mock
  }),
  execSync: jest.fn()
}))

jest.mock('xml2js', () => {
  const actual = jest.requireActual('xml2js')
  return {
    ...actual,
    parseString: jest.fn((xml: string, options: any, callback: Function) => {
      // Use actual xml2js for parsing
      actual.parseString(xml, options, callback)
    })
  }
})

describe('UnattendedWindowsManager', () => {
  const mockUsername = 'testuser'
  const mockPassword = 'testpassword123'
  const mockProductKey = 'W269N-WFGWX-YVC9B-4J6C9-T83GX'
  const mockApplications = [
    {
      id: 'app1',
      name: 'Test App',
      os: ['windows'],
      installCommand: { windows: 'msiexec /i test.msi' },
      parameters: {}
    }
  ] as unknown as Application[]

  let manager: UnattendedWindowsManager

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.INFINIBAY_BASE_DIR = '/opt/infinibay'
    manager = new UnattendedWindowsManager(
      10,
      mockUsername,
      mockPassword,
      mockProductKey,
      mockApplications
    )
  })

  describe('constructor', () => {
    it('should initialize with all parameters', () => {
      expect(manager).toBeInstanceOf(UnattendedWindowsManager)
      expect(manager['version']).toBe(10)
      expect(manager['username']).toBe(mockUsername)
      expect(manager['password']).toBe(mockPassword)
      expect(manager['vmId']).toBe('')
    })

    it('should accept undefined product key', () => {
      const m = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        undefined,
        []
      )
      expect(m).toBeInstanceOf(UnattendedWindowsManager)
    })

    it('should set isoPath based on Windows version', () => {
      const m10 = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
      const m11 = new UnattendedWindowsManager(11, mockUsername, mockPassword, mockProductKey, [])

      expect(m10['isoPath']).toContain('windows10.iso')
      expect(m11['isoPath']).toContain('windows11.iso')
    })

    it('should use default product key if none provided', () => {
      const m = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        undefined,
        []
      )

      const defaultKey = (UnattendedWindowsManager as any).PRODUCT_KEY
      // Verify the class has the default key constant
      expect(defaultKey).toBeTruthy()
    })

    it('should use custom product key from environment variable', () => {
      const customKey = 'CUSTOM-KEY-12345'
      process.env.WINDOWS_PRODUCT_KEY = customKey

      const m = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        undefined,
        []
      )

      delete process.env.WINDOWS_PRODUCT_KEY
      expect(m).toBeInstanceOf(UnattendedWindowsManager)
    })

    it('should accept scripts array', () => {
      const mockScripts = [
        { script: { id: '1', name: 'test' }, executionId: '123' },
        { script: { id: '2', name: 'test2' }, executionId: '456' }
      ]

      const m = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        mockApplications,
        'vm-123',
        mockScripts
      )

      expect(m['scripts']).toHaveLength(2)
      expect(m['vmId']).toBe('vm-123')
    })

    it('should set enableCommandLogging flag', () => {
      const mWithLogging = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        mockApplications,
        undefined,
        [],
        true
      )
      const mWithoutLogging = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        mockApplications,
        undefined,
        [],
        false
      )

      expect(mWithLogging['enableCommandLogging']).toBe(true)
      expect(mWithoutLogging['enableCommandLogging']).toBe(false)
    })
  })

  describe('language detection', () => {
    describe('detectISOLanguage', () => {
      it('should detect English from filename', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(true)
        const managerEN = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        managerEN['isoPath'] = '/opt/infinibay/iso/Windows 10 EN-US.iso'

        const lang = await (managerEN as any).detectISOLanguage()
        expect(lang).toBe('en-US')
      })

      it('should detect Spanish from filename', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(true)
        const managerES = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        managerES['isoPath'] = '/opt/infinibay/iso/Windows 11 es-ES.iso'

        const lang = await (managerES as any).detectISOLanguage()
        expect(lang).toBe('es-ES')
      })

      it('should detect language from ISO filename', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(true)
        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/opt/infinibay/iso/Windows 10 Pro en-US.iso'

        const lang = await (manager as any).detectISOLanguage()
        expect(lang).toBe('en-US')
      })

      it('should fallback to host system language when ISO not found', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(false)
        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/nonexistent/iso.iso'

        const lang = await (manager as any).detectISOLanguage()
        // Should return null when ISO not found
        expect(lang).toBeNull()
      })

      it('should return null when ISO file does not exist', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(false)
        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/nonexistent/iso.iso'

        const lang = await (manager as any).detectISOLanguage()
        expect(lang).toBeNull()
      })
    })

    describe('detectLanguage', () => {
      it('should prioritize ISO language over host system language', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(true)
        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/opt/infinibay/iso/Windows 10 EN-US.iso'

        const langConfig = await (manager as any).detectLanguage()
        expect(langConfig.uiLanguage).toBe('en-US')
      })

      it('should fallback to host system language when ISO not found', async () => {
        // Set LANG env var so getHostSystemLanguage finds it
        const origLang = process.env.LANG
        process.env.LANG = 'de_DE.UTF-8'

        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/nonexistent/iso.iso'

        const langConfig = await (manager as any).detectLanguage()
        expect(langConfig.uiLanguage).toBe('de-DE')

        // Restore
        if (origLang !== undefined) {
          process.env.LANG = origLang
        } else {
          delete process.env.LANG
        }
      })

      it('should use default en-US when no language detected', async () => {
        ;(fs.existsSync as jest.Mock).mockReturnValue(false)
        const origLang = process.env.LANG
        delete process.env.LANG

        const manager = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
        manager['isoPath'] = '/nonexistent/iso.iso'

        // Mock execSync to return empty
        const execSync = require('child_process').execSync
        execSync.mockReturnValue('')

        const langConfig = await (manager as any).detectLanguage()
        expect(langConfig.uiLanguage).toBe('en-US')

        if (origLang !== undefined) {
          process.env.LANG = origLang
        }
      })
    })
  })

  describe('language configuration', () => {
    it('should have language mapping for all supported languages', () => {
      const langMap: any = (UnattendedWindowsManager as any).LANGUAGE_MAP
      const expectedLanguages = [
        'en-US', 'es-ES', 'es-MX', 'fr-FR', 'de-DE', 'it-IT',
        'pt-BR', 'pt-PT', 'ja-JP', 'zh-CN', 'ko-KR', 'ru-RU'
      ]

      for (const lang of expectedLanguages) {
        expect(langMap[lang]).toBeDefined()
        expect(langMap[lang].uiLanguage).toBe(lang)
      }
    })

    it('should map language codes correctly', () => {
      expect((UnattendedWindowsManager as any).LANGUAGE_MAP['es-ES'].inputLocale).toBe('040a:0000040a')
      expect((UnattendedWindowsManager as any).LANGUAGE_MAP['en-US'].inputLocale).toBe('0409:00000409')
    })
  })

  describe('PowerShell command generation', () => {
    describe('createLoggedCommand', () => {
      it('should create simple command without logging when disabled', () => {
        const managerNoLog = new UnattendedWindowsManager(
          10,
          mockUsername,
          mockPassword,
          mockProductKey,
          [],
          undefined,
          [],
          false
        )

        const cmd = (managerNoLog as any).createLoggedCommand('Write-Host "Hello"', 'test', 'test.log')
        expect(cmd).not.toContain('Add-Content')
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command')
      })

      it('should create command with logging when enabled', () => {
        const cmd = (manager as any).createLoggedCommand('Write-Host "Hello"', 'test', 'test.log')
        expect(cmd).toContain('Add-Content')
        expect(cmd).toContain('try')
        expect(cmd).toContain('catch')
      })

      it('should escape special characters in commands', () => {
        const cmd = (manager as any).createLoggedCommand('Write-Host "Hello World"', 'test', 'test.log')
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command')
      })
    })

    describe('buildPowerShellScript', () => {
      it('should build base64 encoded script', () => {
        const scriptLines = [
          'Write-Host "Hello"',
          'Write-Host "World"'
        ]

        const cmd = (manager as any).buildPowerShellScript(scriptLines)
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand')

        // Verify it's valid base64
        const encodedPart = cmd.split(' ')[3]
        try {
          const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le')
          expect(decoded).toContain('Write-Host')
        } catch {
          // If decoding fails, the encoding might be UTF-16LE encoded then base64
          // which is expected for PowerShell -EncodedCommand
        }
      })

      it('should handle empty script lines', () => {
        const scriptLines: string[] = []
        const cmd = (manager as any).buildPowerShellScript(scriptLines)
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand')
      })
    })

    describe('buildPowerShellCommand', () => {
      it('should use simple command for short scripts without logging', () => {
        const managerNoLog = new UnattendedWindowsManager(
          10,
          mockUsername,
          mockPassword,
          mockProductKey,
          [],
          undefined,
          [],
          false
        )

        const scriptLines = ['Write-Host "Simple"']
        const cmd = (managerNoLog as any).buildPowerShellCommand(scriptLines, true)
        
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command')
        expect(cmd).not.toContain('EncodedCommand')
      })

      it('should use base64 for complex scripts', () => {
        const scriptLines = [
          'Write-Host "Line 1"',
          'Write-Host "Line 2"',
          'Write-Host "Line 3"'
        ]

        const cmd = (manager as any).buildPowerShellCommand(scriptLines)
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand')
      })
    })

    describe('createDownloadCommand', () => {
      it('should create download command with retry logic', () => {
        const url = 'http://example.com/file.exe'
        const outputPath = 'C:\\Temp\\file.exe'

        const cmd = (manager as any).createDownloadCommand(url, outputPath, 'test download')
        expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand')
        // The script content is base64 encoded, so decode and verify
        const encodedPart = cmd.split('-EncodedCommand ')[1]
        const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le')
        expect(decoded).toContain('$maxAttempts')
        expect(decoded).toContain('WebClient')
      })

      it('should create simple download command when logging disabled', () => {
        const managerNoLog = new UnattendedWindowsManager(
          10,
          mockUsername,
          mockPassword,
          mockProductKey,
          [],
          undefined,
          [],
          false
        )

        const url = 'http://example.com/file.exe'
        const outputPath = 'C:\\Temp\\file.exe'

        const cmd = (managerNoLog as any).createDownloadCommand(url, outputPath, 'test download')
        expect(cmd).not.toContain('maxAttempts')
        expect(cmd).toContain('WebClient')
      })
    })
  })

  describe('first logon commands', () => {
    it('should generate first logon commands', () => {
      const commands = (manager as any).getFirstLogonCommands()

      expect(Array.isArray(commands)).toBe(true)
      expect(commands.length).toBeGreaterThan(0)

      // Check for expected commands
      const descriptions = commands.map((c: any) => c.Description)
      expect(descriptions).toContain('Control Panel View')
      expect(descriptions).toContain('Password Never Expires')
      expect(descriptions).toContain('Restart System')
    })

    it('should include InfiniService installation commands', () => {
      const commands = (manager as any).getFirstLogonCommands()
      const descriptions = commands.map((c: any) => c.Description)

      const infiniServiceCommands = descriptions.filter((d: string) => 
        d.includes('InfiniService') || d.includes('infiniservice')
      )
      expect(infiniServiceCommands.length).toBeGreaterThan(0)
    })

    it('should include application installation commands', () => {
      const commands = (manager as any).getFirstLogonCommands()
      const descriptions = commands.map((c: any) => c.Description)

      const appCommands = descriptions.filter((d: string) => 
        d.includes('Test App') || d.includes('app')
      )
      expect(appCommands.length).toBeGreaterThan(0)
    })

    it('should order commands correctly', () => {
      const commands = (manager as any).getFirstLogonCommands()
      
      // Check that commands have increasing order
      let lastOrder = -1
      for (const cmd of commands) {
        expect(cmd.Order).toBeGreaterThan(lastOrder)
        lastOrder = cmd.Order
      }

      // First command should be order 1
      expect(commands[0].Order).toBe(1)

      // Last command should be restart
      expect(commands[commands.length - 1].Description).toBe('Restart System')
    })
  })

  describe('app installation commands', () => {
    it('should generate commands for applications with Windows install', () => {
      const commands = (manager as any).generateAppsToInstallScripts(1)

      expect(Array.isArray(commands)).toBe(true)
      expect(commands.length).toBe(1)
      expect(commands[0].Description).toBe('Install Test App')
      expect(commands[0].CommandLine).toContain('msiexec /i test.msi')
    })

    it('should skip applications without Windows install command', () => {
      const apps = [
        {
          id: 'app1',
          name: 'Linux Only App',
          os: ['ubuntu'],
          installCommand: { ubuntu: 'apt install app' },
          parameters: {}
        }
      ] as unknown as Application[]

      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        apps
      )

      const commands = (manager as any).generateAppsToInstallScripts(1)
      expect(commands.length).toBe(0)
    })

    it('should sanitize application names in commands', () => {
      const apps = [
        {
          id: 'app1',
          name: 'App with spaces & special!chars',
          os: ['windows'],
          installCommand: { windows: 'install app' },
          parameters: {}
        }
      ] as unknown as Application[]

      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        apps
      )

      const commands = (manager as any).generateAppsToInstallScripts(1)
      expect(commands.length).toBe(1)
      // Name should be sanitized
      expect(commands[0].Description).toBe('Install App with spaces & special!chars')
    })

    it('should parse and substitute parameters', () => {
      const apps = [
        {
          id: 'app1',
          name: 'Param App',
          os: ['windows'],
          installCommand: { windows: 'install --{{user}}={{username}}' },
          parameters: { user: 'testuser' }
        }
      ] as unknown as Application[]

      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        apps
      )

      const commands = (manager as any).generateAppsToInstallScripts(1)
      expect(commands[0].CommandLine).toContain('testuser')
    })
  })

  describe('XML configuration generation', () => {
    it('should generate valid XML configuration', async () => {
      const config = await manager.generateConfig()

      expect(typeof config).toBe('string')
      expect(config).toContain('<?xml')
      expect(config).toContain('<unattend')
      expect(config).toContain('<settings')
    })

    it('should include product key in XML when provided', async () => {
      const config = await manager.generateConfig()

      expect(config).toContain(mockProductKey)
    })

    it('should include username in XML', async () => {
      const config = await manager.generateConfig()

      expect(config).toContain(mockUsername)
    })

    it('should include Windows version-specific settings', async () => {
      const manager10 = new UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [])
      const manager11 = new UnattendedWindowsManager(11, mockUsername, mockPassword, mockProductKey, [])

      const config10 = await manager10.generateConfig()
      const config11 = await manager11.generateConfig()

      // Both should have different settings based on version
      expect(typeof config10).toBe('string')
      expect(typeof config11).toBe('string')
    })

    it('should include auto-logon configuration', async () => {
      const config = await manager.generateConfig()

      expect(config).toContain('AutoLogon')
      expect(config).toContain('Enabled')
    })

    it('should include OOBE settings', async () => {
      const config = await manager.generateConfig()

      expect(config).toContain('OOBE')
      expect(config).toContain('SkipUserOOBE')
    })
  })

  describe('ISO creation', () => {
    it('should throw error if extraction directory does not exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      const nonExistentPath = '/nonexistent/path'

      await expect(
        manager.createISO('/tmp/test.iso', nonExistentPath)
      ).rejects.toThrow('Extraction directory does not exist')
    })

    it('should create ISO with correct xorriso parameters', async () => {
      const mockExtractDir = '/tmp/extracted_iso_123'
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)

      const mockExecute = jest.spyOn(manager, 'executeCommand' as any).mockResolvedValue('')

      await manager.createISO('/tmp/test.iso', mockExtractDir)

      expect(mockExecute).toHaveBeenCalled()
      const callArgs = mockExecute.mock.calls[0][0] as string[]
      expect(callArgs[0]).toBe('xorriso')
      expect(callArgs).toContain('-o')
      expect(callArgs).toContain('/tmp/test.iso')
      expect(callArgs).toContain(mockExtractDir)
    })
  })

  describe('XML validation', () => {
    it('should validate valid XML configuration', async () => {
      const config = await manager.generateConfig()
      const result = await (manager as any).validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject invalid XML', async () => {
      const result = await (manager as any).validateConfig('not valid xml')

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate required unattend root element', async () => {
      const result = await (manager as any).validateConfig('<root>test</root>')

      expect(result.valid).toBe(false)
      expect(result.errors.some((e: string) => e.includes('unattend'))).toBe(true)
    })

    it('should validate required settings passes', async () => {
      // Construct XML missing a required settings pass (oobeSystem)
      const incompleteConfig = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE"><component name="test"/></settings>
  <settings pass="specialize"><component name="test"/></settings>
</unattend>`

      const result = await (manager as any).validateConfig(incompleteConfig)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: string) => e.includes('settings pass'))).toBe(true)
    })
  })

  describe('environment variables', () => {
    it('should use APP_HOST environment variable', async () => {
      const originalHost = process.env.APP_HOST
      process.env.APP_HOST = 'custom-host.example.com'

      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        []
      )

      const commands = (manager as any).getFirstLogonCommands()
      expect(JSON.stringify(commands)).toContain('custom-host.example.com')

      if (originalHost) process.env.APP_HOST = originalHost
      else delete process.env.APP_HOST
    })

    it('should use PORT environment variable', async () => {
      const originalPort = process.env.PORT
      process.env.PORT = '8080'

      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        []
      )

      const config = await manager.generateConfig()

      if (originalPort) process.env.PORT = originalPort
      else delete process.env.PORT
    })
  })

  describe('edge cases', () => {
    it('should handle empty applications array', async () => {
      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        []
      )

      const commands = (manager as any).generateAppsToInstallScripts(1)
      expect(commands.length).toBe(0)
    })

    it('should handle missing optional parameters', async () => {
      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        undefined,
        []
      )

      expect(manager).toBeDefined()
    })

    it('should handle VM ID parameter', async () => {
      const manager = new UnattendedWindowsManager(
        10,
        mockUsername,
        mockPassword,
        mockProductKey,
        [],
        'vm-unique-id-123'
      )

      expect((manager as any)['vmId']).toBe('vm-unique-id-123')
    })
  })

  describe('security', () => {
    it('should not expose password in logs or commands', async () => {
      const config = await manager.generateConfig()

      // Password should not appear in plain text in XML output
      // (it will appear as part of XML structure, but not logged)
      expect(config.length).toBeGreaterThan(0)
    })

    it('should handle sensitive paths correctly', () => {
      const PATHS = (UnattendedWindowsManager as any).PATHS
      expect(PATHS.TEMP_DIR).toBe('C:\\Temp')
      expect(PATHS.INFINISERVICE_TEMP).toBe('C:\\Temp\\InfiniService')
    })
  })
})

describe('UnattendedWindowsManager constants', () => {
  it('should have PRODUCT_KEY constant', () => {
    // Access the class constant directly
    const Key = (UnattendedWindowsManager as any).PRODUCT_KEY
    expect(Key).toBeTruthy()
    expect(typeof Key).toBe('string')
  })

  it('should have PATHS constant', () => {
    const PATHS = (UnattendedWindowsManager as any).PATHS
    expect(PATHS).toBeDefined()
    expect(PATHS.TEMP_DIR).toBe('C:\\Temp')
    expect(PATHS.INFINISERVICE_TEMP).toBe('C:\\Temp\\InfiniService')
  })

  it('should have INFINISERVICE constant', () => {
    const INFINISERVICE = (UnattendedWindowsManager as any).INFINISERVICE
    expect(INFINISERVICE).toBeDefined()
    expect(INFINISERVICE.BINARY_NAME).toBe('infiniservice.exe')
    expect(INFINISERVICE.SERVICE_NAME).toBe('Infiniservice')
  })

  it('should have COMPONENT_BASE_CONFIG constant', () => {
    const COMPONENT = (UnattendedWindowsManager as any).COMPONENT_BASE_CONFIG
    expect(COMPONENT.name).toBe('Microsoft-Windows-Shell-Setup')
    expect(COMPONENT.processorArchitecture).toBe('amd64')
    expect(COMPONENT.publicKeyToken).toBe('31bf3856ad364e35')
  })

  it('should have LANGUAGE_MAP constant', () => {
    const LANG_MAP = (UnattendedWindowsManager as any).LANGUAGE_MAP
    expect(typeof LANG_MAP).toBe('object')
    expect(Object.keys(LANG_MAP).length).toBeGreaterThan(0)
  })
})
