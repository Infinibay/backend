import { Application } from '@prisma/client'
import { CloudInitInstaller } from '../../../app/services/cloudInitInstaller'
import { resolveOsProfile } from '../../../app/services/install/osProfiles'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as unixcrypt from 'unixcrypt'

describe('CloudInitInstaller', () => {
  const originalEnv = process.env
  const validUsername = 'testuser'
  const validPassword = 'testpass123'
  const mockApplications = [
    {
      id: 'app1',
      name: 'TestApp',
      os: ['ubuntu'],
      installCommand: { ubuntu: 'apt install testapp' },
      parameters: {} as any
    }
  ] as unknown as Application[]

  beforeEach(() => {
    process.env = { ...originalEnv, INFINIBAY_BASE_DIR: '/opt/infinibay' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create instance with valid parameters', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(CloudInitInstaller)
      expect(manager.configFileName).toBe('user-data')
      expect(manager['username']).toBe(validUsername)
    })

    it('should throw error when username is missing', () => {
      expect(() => {
        new CloudInitInstaller('', validPassword, mockApplications)
      }).toThrow('Username and password are required')
    })

    it('should throw error when password is missing', () => {
      expect(() => {
        new CloudInitInstaller(validUsername, '', mockApplications)
      }).toThrow('Username and password are required')
    })

    it('should initialize with empty applications array', () => {
      const manager = new CloudInitInstaller(validUsername, validPassword, [])
      expect(manager['applications']).toEqual([])
    })

    it('should set empty VM ID by default', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )
      expect(manager['vmId']).toBe('')
    })

    it('should set custom VM ID when provided', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications,
        'vm-123'
      )
      expect(manager['vmId']).toBe('vm-123')
    })

    it('should initialize empty scripts array by default', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )
      expect(manager['scripts']).toEqual([])
    })

    it('should accept scripts parameter', () => {
      const mockScripts = [{ id: 'script1', name: 'test' }]
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications,
        undefined,
        mockScripts
      )
      expect(manager['scripts']).toEqual(mockScripts)
    })
  })

  describe('generateConfig', () => {
    it('should generate valid YAML configuration', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()

      expect(config).toBeDefined()
      expect(typeof config).toBe('string')
      expect(config).toContain('#cloud-config')

      // Verify YAML can be parsed
      const parsed = yaml.load(config) as any
      expect(parsed.autoinstall).toBeDefined()
    })

    it('should include autoinstall configuration', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.version).toBe(1)
      expect(parsed.autoinstall.identity).toBeDefined()
      expect(parsed.autoinstall.identity.username).toBe(validUsername)
    })

    it('should encrypt password using unixcrypt', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      // Password should be encrypted (not plain text)
      expect(parsed.autoinstall.identity.password).not.toBe(validPassword)
      expect(parsed.autoinstall.identity.password).not.toBe('')
    })

    it('should generate unique hostname', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config1 = await manager.generateConfig()
      const config2 = await manager.generateConfig()

      const parsed1 = yaml.load(config1) as any
      const parsed2 = yaml.load(config2) as any

      expect(parsed1.autoinstall.identity.hostname).not.toBe(parsed2.autoinstall.identity.hostname)
      expect(parsed1.autoinstall.identity.hostname).toMatch(/^ubuntu-/)
    })

    it('does NOT emit fragile early-commands (subiquity owns DHCP; the old dhclient/ping loops blocked offline)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall['early-commands']).toBeUndefined()
    })

    it('should include shutdown reboot setting', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.shutdown).toBe('reboot')
    })

    it('should set timezone to UTC', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.timezone).toBe('UTC')
    })

    it('OMITS source when none was detected from the ISO (lets subiquity use the ISO default — Server ISOs have no ubuntu-desktop)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      // generateConfig() with no createISO/ISO-detection → no source key.
      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.source).toBeUndefined()
    })

    it('picks the FULL ubuntu-desktop source from the REAL 26.04 OBJECT-shaped install-sources.yaml (regression: object shape → minimized/empty install)', () => {
      // The real 26.04 Desktop install-sources.yaml is a TOP-LEVEL OBJECT
      // { kernel, sources:[...], version:2 } — NOT an array — and marks the
      // *minimized* desktop default:true, the full desktop default:false. The old
      // array-only parser returned [] here → no source written → subiquity used the
      // default:true minimized desktop. This fixture uses the object shape so it
      // FAILS against the old code and locks the fix.
      const ubuntuProfile = resolveOsProfile('ubuntu')!
      expect(ubuntuProfile.cloudInitPreferredSource).toBe('ubuntu-desktop')
      expect(ubuntuProfile.expectedEdition).toBe('desktop')

      const manager = new CloudInitInstaller(
        validUsername, validPassword, mockApplications, undefined, [],
        { osProfile: ubuntuProfile }
      )
      const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-desktop-'))
      try {
        fs.mkdirSync(path.join(extractDir, 'casper'), { recursive: true })
        fs.writeFileSync(path.join(extractDir, 'casper', 'install-sources.yaml'), yaml.dump({
          kernel: { default: 'linux-generic-hwe-24.04' },
          version: 2,
          sources: [
            { id: 'ubuntu-desktop-minimal', default: true, variant: 'desktop', type: 'fsimage-layered', path: 'minimal.squashfs', size: 6484422656, name: { en: 'Ubuntu Desktop (minimized)' } },
            { id: 'ubuntu-desktop', default: false, variant: 'desktop', type: 'fsimage-layered', path: 'minimal.standard.squashfs', size: 8248336384, name: { en: 'Ubuntu Desktop' } }
          ]
        }))
        expect((manager as any).detectInstallSource(extractDir)).toBe('ubuntu-desktop')
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true })
      }
    })

    it('falls back to the ISO default on a Server ISO (array-shaped, no desktop source → ubuntu-server, no stall)', () => {
      // A Server ISO (24.04 array shape) has no desktop variant; a desktop request
      // must still complete on the server default rather than request a missing
      // source (which stalls subiquity).
      const ubuntuProfile = resolveOsProfile('ubuntu')!
      const manager = new CloudInitInstaller(
        validUsername, validPassword, mockApplications, undefined, [],
        { osProfile: ubuntuProfile }
      )
      const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-server-'))
      try {
        fs.mkdirSync(path.join(extractDir, 'casper'), { recursive: true })
        fs.writeFileSync(path.join(extractDir, 'casper', 'install-sources.yaml'), yaml.dump([
          { id: 'ubuntu-server', default: true, variant: 'server' },
          { id: 'ubuntu-server-minimal', default: false, variant: 'server' }
        ]))
        expect((manager as any).detectInstallSource(extractDir)).toBe('ubuntu-server')
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true })
      }
    })

    it('honors parameterized locale / keyboard / timezone (no longer hardcoded us/en_US/UTC)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications,
        undefined,
        [],
        { locale: 'es_AR.UTF-8', keyboard: 'es', timezone: 'America/Argentina/Buenos_Aires' }
      )

      const parsed = yaml.load(await manager.generateConfig()) as any
      expect(parsed.autoinstall.locale).toBe('es_AR.UTF-8')
      expect(parsed.autoinstall.keyboard.layout).toBe('es')
      expect(parsed.autoinstall.timezone).toBe('America/Argentina/Buenos_Aires')
    })

    it('should include late-commands', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall['late-commands']).toBeDefined()
      expect(Array.isArray(parsed.autoinstall['late-commands'])).toBe(true)
    })

    it('INSTALLS infiniservice in late-commands (regression: the install script was generated but never wired → OS installed but VM never reported ready)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications,
        'vm-abc-123' // vmId → per-VM secret + install
      )

      const parsed = yaml.load(await manager.generateConfig()) as any
      const late = (parsed.autoinstall['late-commands'] as string[]).join('\n')

      // The install script must be created AND executed in-target, and it must
      // download the infiniservice binary + installer from the backend endpoints.
      expect(late).toContain('/target/var/lib/cloud/scripts/per-instance/install_infiniservice.sh')
      expect(late).toContain('curtin in-target -- /var/lib/cloud/scripts/per-instance/install_infiniservice.sh')
      expect(late).toContain('/infiniservice/linux/binary')
      expect(late).toContain('/infiniservice/linux/script')
    })

    it('should set keyboard layout to US', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.keyboard.layout).toBe('us')
    })

    it('should set locale', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.locale).toBe('en_US')
    })

    it('does NOT install internet-only restricted codecs/drivers/OEM in the base config (offline-robust)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      // These all require the internet and hang/fail a base install offline.
      expect(parsed.autoinstall.codecs).toBeUndefined()
      expect(parsed.autoinstall.drivers).toBeUndefined()
      expect(parsed.autoinstall.oem).toBeUndefined()
    })
  })

  describe('generateLateCommands', () => {
    it('should generate network validation helper script', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('wait-for-network.sh')
      expect(joined).toContain('MAX_ATTEMPTS')
    })

    it('should include apt-get update in late-commands', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('apt-get update')
    })

    it('should install required packages', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('curl')
      expect(joined).toContain('wget')
      expect(joined).toContain('qemu-guest-agent')
    })

    it('should create cloud scripts directory', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('cloud/scripts/per-instance')
    })

    it('should generate first-boot script commands (handled by InfiniService post-boot)', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      // Scripts are no longer embedded in late-commands;
      // InfiniService handles all FIRST_BOOT scripts post-boot
      expect(commands).toBeDefined()
      expect(commands.length).toBeGreaterThan(0)
    })

  describe('generateInfiniServiceInstallCommands', () => {
    it('should generate InfiniService installation commands', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateInfiniServiceInstallCommands']()

      expect(commands.length).toBeGreaterThan(0)
      expect(commands[0]).toContain('cat > /target/var/lib/cloud/scripts')
    })

    it('should include download with retry logic', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateInfiniServiceInstallCommands']()
      const commandString = commands.join('\n')

      expect(commandString).toContain('MAX_DOWNLOAD_RETRIES')
      expect(commandString).toContain('retry')
    })

    it('resolves the backend from the VM default GATEWAY at runtime, not the unreachable host LAN IP', () => {
      // The VM cannot reach APP_HOST (host LAN IP) from its isolated department
      // network — it must use its default gateway (the bridge IP where the backend
      // listens). The script resolves it at runtime; APP_HOST is only a fallback.
      const manager = new CloudInitInstaller(validUsername, validPassword, mockApplications)
      const s = manager['generateInfiniServiceInstallCommands']().join('\n')

      expect(s).toContain("ip route") // default-gateway resolution
      expect(s).toMatch(/awk '\/\^default\/\{print \$3/) // parse the gateway
      expect(s).toContain('BASE_URL="http://${BACKEND_HOST}:' + (process.env.PORT || '4000')) // runtime host
      expect(s).toContain('${GW:-') // gateway with a fallback host
    })

    it('does not mask curl failures (set -o pipefail + curl exit checked directly)', () => {
      // The old `curl ... | tee` returned tee\'s success, masking curl errors → a
      // failed download reported OK then chmod\'d a missing file and aborted the OS
      // install. Guard against that regression.
      const manager = new CloudInitInstaller(validUsername, validPassword, mockApplications)
      const s = manager['generateInfiniServiceInstallCommands']().join('\n')

      expect(s).toContain('set -o pipefail')
      // curl for the download is NOT piped into tee (its own exit gates the if).
      expect(s).toMatch(/if curl -fsS[^\n]*-o "\$output"[^\n]*; then/)
      expect(s).not.toMatch(/curl -f[^\n]*-o "\$output"[^\n]*\| tee/)
    })

    it('is resilient: first-boot systemd oneshot + NON-FATAL in-target run (a failure never nukes the OS install)', () => {
      const manager = new CloudInitInstaller(validUsername, validPassword, mockApplications)
      const s = manager['generateInfiniServiceInstallCommands']().join('\n')

      expect(s).toContain('/target/etc/systemd/system/infiniservice-install.service')
      expect(s).toContain('curtin in-target -- systemctl enable infiniservice-install.service')
      expect(s).toContain('systemctl disable infiniservice-install.service') // self-disable on success
      // The in-target fast-path run must be non-fatal.
      expect(s).toMatch(/curtin in-target -- \S*install_infiniservice\.sh \|\| echo/)
    })

    it('should include VM ID in installation', async () => {
      const vmId = 'test-vm-123'
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications,
        vmId
      )

      const commands = manager['generateInfiniServiceInstallCommands']()
      const commandString = commands.join('\n')

      expect(commandString).toContain(vmId)
    })
  })


  describe('generateAppScriptCommands', () => {
    it('should generate script commands for each application', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateAppScriptCommands']()

      expect(Array.isArray(commands)).toBe(true)
    })

    it('should filter applications by Ubuntu compatibility', () => {
      const mixedApps = [
        ...mockApplications,
        {
          id: 'app2',
          name: 'WindowsApp',
          os: ['windows'],
          installCommand: { windows: 'winget install' },
          parameters: {} as any
        }
      ] as unknown as Application[]

      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mixedApps
      )

      const commands = manager['generateAppScriptCommands']()

      expect(commands.length).toBeLessThan(mixedApps.length)
    })
  })

  describe('generateMasterInstallScript', () => {
    it('should generate master install script', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const script = manager['generateMasterInstallScript']()

      expect(script).toBeDefined()
      expect(typeof script).toBe('string')
    })

    it('should only include apps with Ubuntu install commands', async () => {
      const mixedApps = [
        ...mockApplications,
        {
          id: 'app2',
          name: 'NoInstallApp',
          os: ['ubuntu'],
          installCommand: null,
          parameters: {} as any
        }
      ] as unknown as Application[]

      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mixedApps
      )

      const script = manager['generateMasterInstallScript']()

      expect(script).toBeDefined()
    })
  })

  describe('parseInstallCommand', () => {
    it('should replace placeholders in command', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install {{packageName}}'
      const parameters = { packageName: 'test-package' }

      const parsed = manager['parseInstallCommand'](command, parameters)

      expect(parsed).toBe("apt install 'test-package'")
    })

    it('should handle multiple placeholders', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install {{package1}} {{package2}}'
      const parameters = { package1: 'pkg1', package2: 'pkg2' }

      const parsed = manager['parseInstallCommand'](command, parameters)

      expect(parsed).toBe("apt install 'pkg1' 'pkg2'")
    })

    it('should return original command when no parameters', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install package'
      const parsed = manager['parseInstallCommand'](command, null)

      expect(parsed).toBe('apt install package')
    })
  })

  describe('getUbuntuInstallCommand', () => {
    it('should return Ubuntu install command', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = manager['getUbuntuInstallCommand'](mockApplications[0])

      expect(command).toBe('apt install testapp')
    })

    it('should return undefined for non-ubuntu install command', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const app = {
        ...mockApplications[0],
        installCommand: { windows: 'winget install' }
      } as unknown as Application

      const command = manager['getUbuntuInstallCommand'](app)

      expect(command).toBeUndefined()
    })

    it('should return undefined for null install command', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const app = {
        ...mockApplications[0],
        installCommand: null
      } as unknown as Application

      const command = manager['getUbuntuInstallCommand'](app)

      expect(command).toBeUndefined()
    })
  })

  describe('validateConfig', () => {
    it('should return valid for properly formatted config', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const validation = await manager['validateConfig'](config)

      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
    })

    it('should return invalid for empty config', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const validation = await manager['validateConfig']('')

      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    it('should return invalid for missing autoinstall section', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const validation = await manager['validateConfig']('some random text')

      expect(validation.valid).toBe(false)
    })

    it('should return invalid for missing identity', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = 'autoinstall:\n  version: 1'
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
    })

    it('should return invalid for missing username', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = `
autoinstall:
  version: 1
  identity: {}
`
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing "autoinstall.identity.username"')
    })

    it('should return invalid for missing password', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = `
autoinstall:
  version: 1
  identity:
    username: testuser
`
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing "autoinstall.identity.password"')
    })
  })

  describe('modifyGrubConfig', () => {
    it('should modify GRUB configuration file', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub.cfg')
      const mockContent = 'set timeout=5\n\nmenuentry { ... }'

      await fs.promises.writeFile(mockGrubCfgPath, mockContent)

      await manager['modifyGrubConfig'](mockGrubCfgPath)

      const modifiedContent = await fs.promises.readFile(mockGrubCfgPath, 'utf-8')

      expect(modifiedContent).toContain('set timeout=3')
      expect(modifiedContent).toContain('default=0')

      await fs.promises.unlink(mockGrubCfgPath)
    })

    it('should add timeout setting if not present', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub2.cfg')
      const mockContent = '# GRUB config\n\nmenuentry'

      await fs.promises.writeFile(mockGrubCfgPath, mockContent)

      await manager['modifyGrubConfig'](mockGrubCfgPath)

      const modifiedContent = await fs.promises.readFile(mockGrubCfgPath, 'utf-8')

      expect(modifiedContent).toContain('set timeout=3')

      await fs.promises.unlink(mockGrubCfgPath)
    })
  })

  describe('findKernelPaths', () => {
    it('should return default paths when standard paths exist', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now())
      const casperDir = path.join(extractDir, 'casper')
      await fs.promises.mkdir(casperDir, { recursive: true })

      // Create dummy files
      await fs.promises.writeFile(path.join(casperDir, 'vmlinuz'), 'dummy')
      await fs.promises.writeFile(path.join(casperDir, 'initrd'), 'dummy')

      const paths = await manager['findKernelPaths'](extractDir)

      expect(paths.vmlinuz).toBe('/casper/vmlinuz')
      expect(paths.initrd).toBe('/casper/initrd')

      await fs.promises.rm(extractDir, { recursive: true, force: true })
    })

    it('should search for files when standard paths do not exist', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now())
      await fs.promises.mkdir(extractDir, { recursive: true })

      const paths = await manager['findKernelPaths'](extractDir)

      expect(paths.vmlinuz).toBe('/casper/vmlinuz')
      expect(paths.initrd).toBe('/casper/initrd')

      await fs.promises.rm(extractDir, { recursive: true, force: true })
    })
  })

  describe('parseShellArgs', () => {
    it('should parse simple arguments', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']('-V Ubuntu -o output.iso')

      expect(args).toEqual(['-V', 'Ubuntu', '-o', 'output.iso'])
    })

    it('should parse quoted arguments', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']("-V 'Ubuntu 24.04'")

      expect(args).toEqual(['-V', 'Ubuntu 24.04'])
    })

    it('should handle double quotes', () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']('-V "Ubuntu 24.04" -o output')

      expect(args).toEqual(['-V', 'Ubuntu 24.04', '-o', 'output'])
    })
  })

  describe('getXorrisoParamsFromISO', () => {
    it('should return empty array when isoinfo fails', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        mockApplications
      )

      const params = await manager['getXorrisoParamsFromISO']('/nonexistent/iso.iso')

      expect(params).toEqual([])
    })
  })

  describe('hasBootAnchors (refuse to fabricate boot geometry)', () => {
    const manager = new CloudInitInstaller(validUsername, validPassword, mockApplications)

    it('accepts params carrying a boot image (-b/-e) AND an appended GPT partition', () => {
      expect((manager as any).hasBootAnchors(['-b', '/boot/grub/i386-pc/eltorito.img', '-append_partition', '2', 'uuid', '--interval:x'])).toBe(true)
      expect((manager as any).hasBootAnchors(['-e', '--interval:y', '-append_partition', '2'])).toBe(true)
    })

    it('rejects empty / partial params (would otherwise trigger fabricated geometry → non-bootable ISO)', () => {
      expect((manager as any).hasBootAnchors([])).toBe(false)
      expect((manager as any).hasBootAnchors(['-b', '/eltorito.img'])).toBe(false) // no -append_partition
      expect((manager as any).hasBootAnchors(['-append_partition', '2'])).toBe(false) // no boot image
    })
  })

  describe('verifyGeneratedIso (post-build integrity gate)', () => {
    function mgr (): CloudInitInstaller {
      const m = new CloudInitInstaller(validUsername, validPassword, mockApplications)
      ;(m as any).isoPath = '/opt/infinibay/iso/ubuntu.iso'
      return m
    }

    it('THROWS when the output is implausibly smaller than the base (the shipped-bug fingerprint: 3.4GB from a 6.5GB base)', async () => {
      const m = mgr()
      const statSpy = jest.spyOn(fs.promises, 'stat') as any
      statSpy.mockImplementation(async (p: string) =>
        ({ size: String(p).includes('gen') ? 3_405_469_696 : 6_518_974_464 }))
      await expect((m as any).verifyGeneratedIso('/tmp/gen.iso')).rejects.toThrow(/outside the sane/)
      statSpy.mockRestore()
    })

    it('THROWS when a required squashfs is missing from the generated ISO', async () => {
      const m = mgr()
      ;(m as any).detectedSourceInfo = { id: 'ubuntu-desktop', variant: 'desktop', minimal: false, type: 'fsimage-layered', path: 'minimal.standard.squashfs', size: 0, isDefault: false }
      ;(m as any).allSources = [
        { id: 'ubuntu-desktop-minimal', variant: 'desktop', minimal: true, type: 'fsimage-layered', path: 'minimal.squashfs', size: 0, isDefault: true },
        (m as any).detectedSourceInfo
      ]
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 6_400_000_000 } as any)
      // Listing has the base layer but NOT minimal.standard.squashfs.
      jest.spyOn(m as any, 'executeCommand').mockResolvedValue('casper/minimal.squashfs\ncasper/vmlinuz')
      await expect((m as any).verifyGeneratedIso('/tmp/gen.iso')).rejects.toThrow(/MISSING squashfs required by install source 'ubuntu-desktop'.*minimal\.standard\.squashfs/)
      jest.restoreAllMocks()
    })

    it('PASSES when size is sane and both the full + base layered squashfs are present', async () => {
      const m = mgr()
      ;(m as any).detectedSourceInfo = { id: 'ubuntu-desktop', variant: 'desktop', minimal: false, type: 'fsimage-layered', path: 'minimal.standard.squashfs', size: 0, isDefault: false }
      ;(m as any).allSources = [
        { id: 'ubuntu-desktop-minimal', variant: 'desktop', minimal: true, type: 'fsimage-layered', path: 'minimal.squashfs', size: 0, isDefault: true },
        (m as any).detectedSourceInfo
      ]
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 6_500_000_000 } as any)
      jest.spyOn(m as any, 'executeCommand').mockResolvedValue('casper/minimal.squashfs\ncasper/minimal.standard.squashfs\ncasper/vmlinuz')
      await expect((m as any).verifyGeneratedIso('/tmp/gen.iso')).resolves.toBeUndefined()
      jest.restoreAllMocks()
    })

    it('is a no-op on the presence check when no source was detected (non-casper distro)', async () => {
      const m = mgr()
      ;(m as any).detectedSourceInfo = undefined
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 6_500_000_000 } as any)
      const execSpy = jest.spyOn(m as any, 'executeCommand')
      await expect((m as any).verifyGeneratedIso('/tmp/gen.iso')).resolves.toBeUndefined()
      expect(execSpy).not.toHaveBeenCalled() // no 7z listing when there's nothing to verify
      jest.restoreAllMocks()
    })
  })

  describe('edge cases', () => {
    it('should handle empty applications array', async () => {
      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        []
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall).toBeDefined()
    })

    it('should handle applications with no install commands', async () => {
      const apps = [{
        id: 'app1',
        name: 'NoInstallApp',
        os: 'ubuntu',
        installCommand: null,
        parameters: {} as any
      } as unknown as Application]

      const manager = new CloudInitInstaller(
        validUsername,
        validPassword,
        apps
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall).toBeDefined()
    })
  })
  })
})
