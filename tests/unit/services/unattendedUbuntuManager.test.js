"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const unattendedUbuntuManager_1 = require("../../../app/services/unattendedUbuntuManager");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
describe('UnattendedUbuntuManager', () => {
    const originalEnv = process.env;
    const validUsername = 'testuser';
    const validPassword = 'testpass123';
    const mockApplications = [
        {
            id: 'app1',
            name: 'TestApp',
            os: ['ubuntu'],
            installCommand: { ubuntu: 'apt install testapp' },
            parameters: {}
        }
    ];
    beforeEach(() => {
        process.env = Object.assign(Object.assign({}, originalEnv), { INFINIBAY_BASE_DIR: '/opt/infinibay' });
    });
    afterEach(() => {
        process.env = originalEnv;
    });
    describe('constructor', () => {
        it('should create instance with valid parameters', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            expect(manager).toBeDefined();
            expect(manager).toBeInstanceOf(unattendedUbuntuManager_1.UnattendedUbuntuManager);
            expect(manager.configFileName).toBe('user-data');
            expect(manager['username']).toBe(validUsername);
        });
        it('should throw error when username is missing', () => {
            expect(() => {
                new unattendedUbuntuManager_1.UnattendedUbuntuManager('', validPassword, mockApplications);
            }).toThrow('Username and password are required');
        });
        it('should throw error when password is missing', () => {
            expect(() => {
                new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, '', mockApplications);
            }).toThrow('Username and password are required');
        });
        it('should initialize with empty applications array', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, []);
            expect(manager['applications']).toEqual([]);
        });
        it('should set empty VM ID by default', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            expect(manager['vmId']).toBe('');
        });
        it('should set custom VM ID when provided', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, 'vm-123');
            expect(manager['vmId']).toBe('vm-123');
        });
        it('should initialize empty scripts array by default', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            expect(manager['scripts']).toEqual([]);
        });
        it('should accept scripts parameter', () => {
            const mockScripts = [{ id: 'script1', name: 'test' }];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, undefined, mockScripts);
            expect(manager['scripts']).toEqual(mockScripts);
        });
    });
    describe('generateConfig', () => {
        it('should generate valid YAML configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            expect(config).toBeDefined();
            expect(typeof config).toBe('string');
            expect(config).toContain('#cloud-config');
            // Verify YAML can be parsed
            const parsed = yaml.load(config);
            expect(parsed.autoinstall).toBeDefined();
        }));
        it('should include autoinstall configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.version).toBe(1);
            expect(parsed.autoinstall.identity).toBeDefined();
            expect(parsed.autoinstall.identity.username).toBe(validUsername);
        }));
        it('should encrypt password using unixcrypt', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            // Password should be encrypted (not plain text)
            expect(parsed.autoinstall.identity.password).not.toBe(validPassword);
            expect(parsed.autoinstall.identity.password).not.toBe('');
        }));
        it('should generate unique hostname', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config1 = yield manager.generateConfig();
            const config2 = yield manager.generateConfig();
            const parsed1 = yaml.load(config1);
            const parsed2 = yaml.load(config2);
            expect(parsed1.autoinstall.identity.hostname).not.toBe(parsed2.autoinstall.identity.hostname);
            expect(parsed1.autoinstall.identity.hostname).toMatch(/^ubuntu-/);
        }));
        it('should include network early-commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall['early-commands']).toBeDefined();
            expect(Array.isArray(parsed.autoinstall['early-commands'])).toBe(true);
        }));
        it('should include shutdown reboot setting', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.shutdown).toBe('reboot');
        }));
        it('should set timezone to UTC', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.timezone).toBe('UTC');
        }));
        it('should include source configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.source).toBeDefined();
            expect(parsed.autoinstall.source.id).toBe('ubuntu-desktop');
        }));
        it('should include late-commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall['late-commands']).toBeDefined();
            expect(Array.isArray(parsed.autoinstall['late-commands'])).toBe(true);
        }));
        it('should set keyboard layout to US', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.keyboard.layout).toBe('us');
        }));
        it('should set locale', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.locale).toBe('en_US');
        }));
        it('should enable codecs and drivers', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall.codecs.install).toBe(true);
            expect(parsed.autoinstall.drivers.install).toBe(true);
            expect(parsed.autoinstall.oem.install).toBe('auto');
        }));
    });
    describe('generateLateCommands', () => {
        it('should generate network validation helper script', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateLateCommands']();
            const joined = commands.join('\n');
            expect(joined).toContain('wait-for-network.sh');
            expect(joined).toContain('MAX_ATTEMPTS');
        }));
        it('should include apt-get update in late-commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateLateCommands']();
            const joined = commands.join('\n');
            expect(joined).toContain('apt-get update');
        }));
        it('should install required packages', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateLateCommands']();
            const joined = commands.join('\n');
            expect(joined).toContain('curl');
            expect(joined).toContain('wget');
            expect(joined).toContain('qemu-guest-agent');
        }));
        it('should create cloud scripts directory', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateLateCommands']();
            const joined = commands.join('\n');
            expect(joined).toContain('cloud/scripts/per-instance');
        }));
        it('should generate first-boot script commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateLateCommands']();
            const commandsWithScripts = manager['generateFirstBootScriptCommands']();
            // With no scripts configured, generateFirstBootScriptCommands returns empty array
            expect(commandsWithScripts).toEqual([]);
        }));
    });
    describe('generateInfiniServiceInstallCommands', () => {
        it('should generate InfiniService installation commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateInfiniServiceInstallCommands']();
            expect(commands.length).toBeGreaterThan(0);
            expect(commands[0]).toContain('cat > /target/var/lib/cloud/scripts');
        }));
        it('should include download with retry logic', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateInfiniServiceInstallCommands']();
            const commandString = commands.join('\n');
            expect(commandString).toContain('MAX_DOWNLOAD_RETRIES');
            expect(commandString).toContain('retry');
        }));
        it('should use backend URL from environment', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateInfiniServiceInstallCommands']();
            const commandString = commands.join('\n');
            expect(commandString).toContain(`http://${process.env.APP_HOST || 'localhost'}:${process.env.PORT || '4000'}`);
        }));
        it('should include VM ID in installation', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-123';
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, vmId);
            const commands = manager['generateInfiniServiceInstallCommands']();
            const commandString = commands.join('\n');
            expect(commandString).toContain(vmId);
        }));
    });
    describe('generateFirstBootScriptCommands', () => {
        it('should generate commands for each script', () => {
            const mockScripts = [
                {
                    script: { name: 'TestScript', id: 'script-1' },
                    inputValues: {},
                    executionId: 'exec-1'
                }
            ];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, undefined, mockScripts);
            const commands = manager['generateFirstBootScriptCommands']();
            expect(commands.length).toBeGreaterThan(0);
            expect(commands.join('\n')).toContain('TestScript');
        });
        it('should sanitize script names', () => {
            const mockScripts = [
                {
                    script: { name: 'Test Script 123!', id: 'script-1' },
                    inputValues: {},
                    executionId: 'exec-1'
                }
            ];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, undefined, mockScripts);
            const commands = manager['generateFirstBootScriptCommands']();
            const commandString = commands.join('\n');
            // The sanitized script name should be used in file paths (no spaces or special chars in the name part)
            // sanitizeScriptName('Test Script 123!') -> 'Test_Script_123'
            expect(commandString).toContain('Test_Script_123');
            // File paths should use the sanitized name
            expect(commandString).toContain('/tmp/Test_Script_123_exec-1.sh');
        });
        it('should include download and execute script commands', () => {
            const mockScripts = [
                {
                    script: { name: 'TestScript', id: 'script-1' },
                    inputValues: {},
                    executionId: 'exec-1'
                }
            ];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications, undefined, mockScripts);
            const commands = manager['generateFirstBootScriptCommands']();
            const commandString = commands.join('\n');
            expect(commandString).toContain('curl');
            expect(commandString).toContain('chmod +x');
        });
    });
    describe('generateAppScriptCommands', () => {
        it('should generate script commands for each application', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const commands = manager['generateAppScriptCommands']();
            expect(Array.isArray(commands)).toBe(true);
        });
        it('should filter applications by Ubuntu compatibility', () => {
            const mixedApps = [
                ...mockApplications,
                {
                    id: 'app2',
                    name: 'WindowsApp',
                    os: ['windows'],
                    installCommand: { windows: 'winget install' },
                    parameters: {}
                }
            ];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mixedApps);
            const commands = manager['generateAppScriptCommands']();
            expect(commands.length).toBeLessThan(mixedApps.length);
        });
    });
    describe('generateMasterInstallScript', () => {
        it('should generate master install script', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const script = manager['generateMasterInstallScript']();
            expect(script).toBeDefined();
            expect(typeof script).toBe('string');
        }));
        it('should only include apps with Ubuntu install commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const mixedApps = [
                ...mockApplications,
                {
                    id: 'app2',
                    name: 'NoInstallApp',
                    os: ['ubuntu'],
                    installCommand: null,
                    parameters: {}
                }
            ];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mixedApps);
            const script = manager['generateMasterInstallScript']();
            expect(script).toBeDefined();
        }));
    });
    describe('parseInstallCommand', () => {
        it('should replace placeholders in command', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const command = 'apt install {{packageName}}';
            const parameters = { packageName: 'test-package' };
            const parsed = manager['parseInstallCommand'](command, parameters);
            expect(parsed).toBe('apt install test-package');
        });
        it('should handle multiple placeholders', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const command = 'apt install {{package1}} {{package2}}';
            const parameters = { package1: 'pkg1', package2: 'pkg2' };
            const parsed = manager['parseInstallCommand'](command, parameters);
            expect(parsed).toBe('apt install pkg1 pkg2');
        });
        it('should return original command when no parameters', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const command = 'apt install package';
            const parsed = manager['parseInstallCommand'](command, null);
            expect(parsed).toBe('apt install package');
        });
    });
    describe('getUbuntuInstallCommand', () => {
        it('should return Ubuntu install command', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const command = manager['getUbuntuInstallCommand'](mockApplications[0]);
            expect(command).toBe('apt install testapp');
        });
        it('should return undefined for non-ubuntu install command', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const app = Object.assign(Object.assign({}, mockApplications[0]), { installCommand: { windows: 'winget install' } });
            const command = manager['getUbuntuInstallCommand'](app);
            expect(command).toBeUndefined();
        });
        it('should return undefined for null install command', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const app = Object.assign(Object.assign({}, mockApplications[0]), { installCommand: null });
            const command = manager['getUbuntuInstallCommand'](app);
            expect(command).toBeUndefined();
        });
    });
    describe('validateConfig', () => {
        it('should return valid for properly formatted config', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const config = yield manager.generateConfig();
            const validation = yield manager['validateConfig'](config);
            expect(validation.valid).toBe(true);
            expect(validation.errors).toEqual([]);
        }));
        it('should return invalid for empty config', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const validation = yield manager['validateConfig']('');
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
        }));
        it('should return invalid for missing autoinstall section', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const validation = yield manager['validateConfig']('some random text');
            expect(validation.valid).toBe(false);
        }));
        it('should return invalid for missing identity', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const invalidConfig = 'autoinstall:\n  version: 1';
            const validation = yield manager['validateConfig'](invalidConfig);
            expect(validation.valid).toBe(false);
        }));
        it('should return invalid for missing username', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const invalidConfig = `
autoinstall:
  version: 1
  identity: {}
`;
            const validation = yield manager['validateConfig'](invalidConfig);
            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('Missing "autoinstall.identity.username"');
        }));
        it('should return invalid for missing password', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const invalidConfig = `
autoinstall:
  version: 1
  identity:
    username: testuser
`;
            const validation = yield manager['validateConfig'](invalidConfig);
            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('Missing "autoinstall.identity.password"');
        }));
    });
    describe('modifyGrubConfig', () => {
        it('should modify GRUB configuration file', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub.cfg');
            const mockContent = 'set timeout=5\n\nmenuentry { ... }';
            yield fs.promises.writeFile(mockGrubCfgPath, mockContent);
            yield manager['modifyGrubConfig'](mockGrubCfgPath);
            const modifiedContent = yield fs.promises.readFile(mockGrubCfgPath, 'utf-8');
            expect(modifiedContent).toContain('set timeout=3');
            expect(modifiedContent).toContain('default=0');
            yield fs.promises.unlink(mockGrubCfgPath);
        }));
        it('should add timeout setting if not present', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub2.cfg');
            const mockContent = '# GRUB config\n\nmenuentry';
            yield fs.promises.writeFile(mockGrubCfgPath, mockContent);
            yield manager['modifyGrubConfig'](mockGrubCfgPath);
            const modifiedContent = yield fs.promises.readFile(mockGrubCfgPath, 'utf-8');
            expect(modifiedContent).toContain('set timeout=3');
            yield fs.promises.unlink(mockGrubCfgPath);
        }));
    });
    describe('findKernelPaths', () => {
        it('should return default paths when standard paths exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now());
            const casperDir = path.join(extractDir, 'casper');
            yield fs.promises.mkdir(casperDir, { recursive: true });
            // Create dummy files
            yield fs.promises.writeFile(path.join(casperDir, 'vmlinuz'), 'dummy');
            yield fs.promises.writeFile(path.join(casperDir, 'initrd'), 'dummy');
            const paths = yield manager['findKernelPaths'](extractDir);
            expect(paths.vmlinuz).toBe('/casper/vmlinuz');
            expect(paths.initrd).toBe('/casper/initrd');
            yield fs.promises.rm(extractDir, { recursive: true, force: true });
        }));
        it('should search for files when standard paths do not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now());
            yield fs.promises.mkdir(extractDir, { recursive: true });
            const paths = yield manager['findKernelPaths'](extractDir);
            expect(paths.vmlinuz).toBe('/casper/vmlinuz');
            expect(paths.initrd).toBe('/casper/initrd');
            yield fs.promises.rm(extractDir, { recursive: true, force: true });
        }));
    });
    describe('parseShellArgs', () => {
        it('should parse simple arguments', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const args = manager['parseShellArgs']('-V Ubuntu -o output.iso');
            expect(args).toEqual(['-V', 'Ubuntu', '-o', 'output.iso']);
        });
        it('should parse quoted arguments', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const args = manager['parseShellArgs']("-V 'Ubuntu 24.04'");
            expect(args).toEqual(['-V', 'Ubuntu 24.04']);
        });
        it('should handle double quotes', () => {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const args = manager['parseShellArgs']('-V "Ubuntu 24.04" -o output');
            expect(args).toEqual(['-V', 'Ubuntu 24.04', '-o', 'output']);
        });
    });
    describe('getXorrisoParamsFromISO', () => {
        it('should return empty array when isoinfo fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, mockApplications);
            const params = yield manager['getXorrisoParamsFromISO']('/nonexistent/iso.iso');
            expect(params).toEqual([]);
        }));
    });
    describe('edge cases', () => {
        it('should handle empty applications array', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, []);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall).toBeDefined();
        }));
        it('should handle applications with no install commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const apps = [{
                    id: 'app1',
                    name: 'NoInstallApp',
                    os: 'ubuntu',
                    installCommand: null,
                    parameters: {}
                }];
            const manager = new unattendedUbuntuManager_1.UnattendedUbuntuManager(validUsername, validPassword, apps);
            const config = yield manager.generateConfig();
            const parsed = yaml.load(config);
            expect(parsed.autoinstall).toBeDefined();
        }));
    });
});
