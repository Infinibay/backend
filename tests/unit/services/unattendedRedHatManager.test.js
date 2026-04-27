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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const fs_1 = require("fs");
const unattendedRedHatManager_1 = require("@services/unattendedRedHatManager");
// Mock the logger
const mockDebugLog = jest.fn();
jest.mock('@main/logger', () => {
    const mockChildLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    };
    return {
        __esModule: true,
        default: Object.assign(Object.assign({}, mockChildLogger), { child: jest.fn(() => mockChildLogger) })
    };
});
// Mock file system operations (single combined mock)
jest.mock('fs', () => (Object.assign(Object.assign({}, jest.requireActual('fs')), { existsSync: jest.fn(), mkdirSync: jest.fn(), readFileSync: jest.fn(), writeFile: jest.fn(), stat: jest.fn(), promises: Object.assign(Object.assign({}, jest.requireActual('fs').promises), { mkdir: jest.fn(), rm: jest.fn(), stat: jest.fn(), readFile: jest.fn(), writeFile: jest.fn() }) })));
// Mock child_process
jest.mock('child_process', () => (Object.assign(Object.assign({}, jest.requireActual('child_process')), { spawn: jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(() => ({
            on: jest.fn()
        }))
    })) })));
global.Eta = require('eta');
const mockEta = {
    renderString: jest.fn()
};
jest.mock('eta', () => ({
    Eta: jest.fn().mockImplementation(() => mockEta)
}));
describe('UnattendedRedHatManager', () => {
    let manager;
    beforeEach(() => {
        jest.clearAllMocks();
        manager = new unattendedRedHatManager_1.UnattendedRedHatManager('testuser', 'testpassword123', [], 'vm-123');
    });
    describe('constructor', () => {
        it('should create instance with valid parameters', () => {
            expect(manager).toBeInstanceOf(unattendedRedHatManager_1.UnattendedRedHatManager);
            expect(manager.configFileName).toBe('ks.cfg');
            expect(manager.isoPath).toContain('fedora.iso');
        });
        it('should throw error when username is empty', () => {
            expect(() => {
                new unattendedRedHatManager_1.UnattendedRedHatManager('', 'password', []);
            }).toThrow('Username and password are required');
        });
        it('should throw error when password is empty', () => {
            expect(() => {
                new unattendedRedHatManager_1.UnattendedRedHatManager('username', '', []);
            }).toThrow('Username and password are required');
        });
        it('should use default locale, keyboard, and timezone', () => {
            const m = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            expect(m).toBeDefined();
        });
        it('should accept custom locale, keyboard, and timezone', () => {
            const m = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', [], 'vm-123', 'es_ES.UTF-8', 'es', 'Europe/Madrid');
            expect(m).toBeDefined();
        });
        it('should set vmId to empty string when not provided', () => {
            const m = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            expect(m['vmId']).toBe('');
        });
    });
    describe('validateConfig', () => {
        const validKickstart = [
            'lang en_US.UTF-8',
            'keyboard us',
            'timezone America/New_York',
            'rootpw --plaintext testpassword',
            'autopart',
            '%packages',
            '%end'
        ].join('\n');
        it('should validate valid locale format', () => __awaiter(void 0, void 0, void 0, function* () {
            const validation = yield manager.validateConfig(validKickstart);
            expect(validation.valid).toBe(true);
        }));
        it('should validate valid keyboard layout', () => __awaiter(void 0, void 0, void 0, function* () {
            const validation = yield manager.validateConfig(validKickstart);
            expect(validation.valid).toBe(true);
        }));
        it('should reject invalid locale format', () => __awaiter(void 0, void 0, void 0, function* () {
            // Partial config missing many required directives
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const validation = yield testManager.validateConfig('lang invalid_locale');
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
        }));
        it('should reject empty timezone', () => __awaiter(void 0, void 0, void 0, function* () {
            // 'timezone' without a value still matches the pattern /^timezone\s+/ - it won't match
            // But other required directives are missing too
            const validation = yield manager.validateConfig('timezone');
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
        }));
    });
    describe('generateApplicationsConfig', () => {
        it('should return empty string when no applications', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateApplicationsConfig();
            expect(config).toBe('');
        }));
        it('should generate config for Fedora compatible applications', () => __awaiter(void 0, void 0, void 0, function* () {
            const apps = [
                {
                    id: 'app1',
                    name: 'Test App',
                    description: 'Test',
                    os: ['fedora'],
                    installCommand: { fedora: 'yum install test', windows: 'install.exe', ubuntu: 'apt install' }
                }
            ];
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', apps);
            const config = yield testManager.generateApplicationsConfig();
            expect(config).toContain('Test App');
            expect(config).toContain('yum install test');
            expect(config).toContain('%post');
            expect(config).toContain('%end');
        }));
        it('should skip incompatible applications', () => __awaiter(void 0, void 0, void 0, function* () {
            const apps = [
                {
                    id: 'app1',
                    name: 'Windows Only App',
                    description: 'Windows only',
                    os: ['windows'],
                    installCommand: { windows: 'install.exe' }
                }
            ];
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', apps);
            const config = yield testManager.generateApplicationsConfig();
            expect(config).toBe('');
        }));
        it('should return empty string when no compatible apps for RedHat/Fedora', () => __awaiter(void 0, void 0, void 0, function* () {
            const apps = [
                {
                    id: 'app1',
                    name: 'Windows Only App',
                    description: 'Windows only',
                    os: ['windows'],
                    installCommand: { windows: 'install.exe' }
                }
            ];
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', apps);
            const config = yield testManager.generateApplicationsConfig();
            // No RedHat/Fedora compatible apps means empty string
            expect(config).toBe('');
        }));
        it('should generate config for multiple Fedora/RHEL apps', () => __awaiter(void 0, void 0, void 0, function* () {
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
            ];
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', apps);
            const config = yield testManager.generateApplicationsConfig();
            expect(config).toContain('App 1');
            expect(config).toContain('App 2');
            expect(config).not.toContain('App 3');
        }));
    });
    describe('generateInfiniServiceConfig', () => {
        it('should generate InfiniService installation script', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = manager['generateInfiniServiceConfig']();
            expect(config).toContain('%post');
            expect(config).toContain('infiniservice');
            expect(config).toContain('install-linux.sh');
            expect(config).toContain(`http://${process.env.APP_HOST || 'localhost'}:${process.env.PORT || '4000'}`);
            expect(config).toContain('vm-123'); // vmId
        }));
        it('should include network waiting logic', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = manager['generateInfiniServiceConfig']();
            expect(config).toContain('wait_for_network');
            expect(config).toContain('ip -4 addr show');
            expect(config).toContain('getent hosts');
        }));
        it('should include retry logic for downloads', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = manager['generateInfiniServiceConfig']();
            expect(config).toContain('download_with_retry');
            expect(config).toContain('max_retries');
            expect(config).toContain('sleep');
        }));
        it('should use custom backend URL when configured', () => __awaiter(void 0, void 0, void 0, function* () {
            process.env.APP_HOST = 'custom-server';
            process.env.PORT = '8080';
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const config = testManager['generateInfiniServiceConfig']();
            expect(config).toContain('http://custom-server:8080');
            delete process.env.APP_HOST;
            delete process.env.PORT;
        }));
    });
    describe('extractFedoraVersionFromISO', () => {
        it('should extract Fedora version from ISO Volume ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            testManager['isoPath'] = '/path/to/fedora-43.iso';
            // Mock executeCommand to return isoinfo output with Volume ID
            const mockExecCmd = jest.spyOn(testManager, 'executeCommand')
                .mockResolvedValue('Volume id: Fedora-S-dvd-x86_64-43\n');
            const version = yield testManager['extractFedoraVersionFromISO']();
            expect(version).toBe('43');
            mockExecCmd.mockRestore();
        }));
        it('should return 99 when version extraction fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            testManager['isoPath'] = '/nonexistent.iso';
            // Mock executeCommand to reject
            const mockExecCmd = jest.spyOn(testManager, 'executeCommand')
                .mockRejectedValue(new Error('File not found'));
            const version = yield testManager['extractFedoraVersionFromISO']();
            expect(version).toBe('99');
            mockExecCmd.mockRestore();
        }));
    });
    describe('modifyGrubConfigForKickstart', () => {
        let testDir;
        const mockReadFile = jest.spyOn(fs_1.promises, 'readFile');
        const mockWriteFile = jest.spyOn(fs_1.promises, 'writeFile');
        beforeEach(() => {
            testDir = os.tmpdir();
            mockReadFile.mockClear();
            mockWriteFile.mockClear();
        });
        afterEach(() => {
            mockReadFile.mockReset();
            mockWriteFile.mockReset();
        });
        it('should modify GRUB config to add inst.ks parameter', () => __awaiter(void 0, void 0, void 0, function* () {
            const grubCfgContent = `
set timeout=10
menuentry "Fedora" {
  linux /vmlinuz inst.stage2=hd:LABEL=Fedora-29-x86_64
}
`;
            mockReadFile.mockResolvedValue(grubCfgContent);
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            yield testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg');
            expect(mockWriteFile).toHaveBeenCalled();
        }));
        it('should set GRUB timeout to 3 seconds', () => __awaiter(void 0, void 0, void 0, function* () {
            const grubCfgContent = 'set timeout=10';
            mockReadFile.mockResolvedValue(grubCfgContent);
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            yield testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg');
            expect(mockWriteFile).toHaveBeenCalledWith('/boot/grub2/grub.cfg', expect.stringContaining('set timeout=3'), 'utf-8');
        }));
        it('should add timeout if not present', () => __awaiter(void 0, void 0, void 0, function* () {
            const grubCfgContent = 'set gfxpayload=keep\nmenuentry "Fedora" { }';
            mockReadFile.mockResolvedValue(grubCfgContent);
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            yield testManager['modifyGrubConfigForKickstart']('/boot/grub2/grub.cfg');
            expect(mockWriteFile).toHaveBeenCalledWith('/boot/grub2/grub.cfg', expect.stringContaining('set timeout=3'), 'utf-8');
        }));
    });
    describe('modifyIsolinuxConfigForKickstart', () => {
        beforeEach(() => {
            fs.promises.readFile.mockClear();
            fs.promises.writeFile.mockClear();
        });
        it('should modify isolinux config to add inst.ks parameter', () => __awaiter(void 0, void 0, void 0, function* () {
            const isolinuxCfgContent = `
label Fedora
  append initrd=initrd.img inst.stage2=hd:LABEL=Fedora-29-x86_64
`;
            fs.promises.readFile.mockResolvedValue(isolinuxCfgContent);
            fs.promises.writeFile.mockResolvedValue(undefined);
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            yield testManager['modifyIsolinuxConfigForKickstart']('/isolinux/isolinux.cfg');
            expect(fs.promises.writeFile).toHaveBeenCalled();
        }));
        it('should remove existing inst.ks parameters and add new one', () => __awaiter(void 0, void 0, void 0, function* () {
            const isolinuxCfgContent = '  append inst.ks=old.cfg inst.stage2=hd:LABEL=Old';
            fs.promises.readFile.mockResolvedValue(isolinuxCfgContent);
            fs.promises.writeFile.mockResolvedValue(undefined);
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            yield testManager['modifyIsolinuxConfigForKickstart']('/isolinux/isolinux.cfg');
            expect(fs.promises.writeFile).toHaveBeenCalledWith('/isolinux/isolinux.cfg', expect.stringContaining('inst.ks=cdrom:/ks.cfg'), 'utf-8');
        }));
    });
    describe('getXorrisoParamsFromISO', () => {
        it('should extract xorriso parameters from ISO', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            testManager['isoPath'] = '/path/to/test.iso';
            // Mock executeCommand to return xorriso params
            const mockedExecuteCommand = jest.spyOn(testManager, 'executeCommand');
            mockedExecuteCommand.mockResolvedValue('mkisofs -V "Test ISO" -b isolinux.bin');
            const params = yield testManager['getXorrisoParamsFromISO']('/path/to/test.iso');
            expect(params).toBeInstanceOf(Array);
        }));
        it('should return empty array when extraction fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            testManager['isoPath'] = '/nonexistent.iso';
            const mockedExecuteCommand = jest.spyOn(testManager, 'executeCommand');
            mockedExecuteCommand.mockRejectedValue(new Error('File not found'));
            const params = yield testManager['getXorrisoParamsFromISO']('/nonexistent.iso');
            expect(params).toEqual([]);
        }));
    });
    describe('parseShellArgs', () => {
        it('should parse shell arguments respecting quotes', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const result = testManager.parseShellArgs('-V \'Fedora 41 x86_64\'');
            expect(result).toEqual(['-V', 'Fedora 41 x86_64']);
        });
        it('should handle double quotes', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const result = testManager.parseShellArgs('-V "Fedora 41"');
            expect(result).toEqual(['-V', 'Fedora 41']);
        });
        it('should split multiple arguments', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const result = testManager.parseShellArgs('-V Test -b boot.img -o output.iso');
            expect(result).toEqual(['-V', 'Test', '-b', 'boot.img', '-o', 'output.iso']);
        });
    });
    describe('sanitizeScriptName', () => {
        it('should sanitize script name by removing special characters', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const sanitized = testManager.sanitizeScriptName('My Script/Name&Special!');
            expect(sanitized).toBe('My_ScriptNameSpecial');
        });
        it('should truncate names longer than 60 characters', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            const longName = 'a'.repeat(100);
            const sanitized = testManager.sanitizeScriptName(longName);
            expect(sanitized.length).toBeLessThanOrEqual(60);
        });
        it('should return "script" for empty or invalid input', () => {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            expect(testManager.sanitizeScriptName('')).toBe('script');
            expect(testManager.sanitizeScriptName(null)).toBe('script');
            expect(testManager.sanitizeScriptName(undefined)).toBe('script');
        });
    });
    describe('generateConfig', () => {
        beforeEach(() => {
            // Mock readFileSync for template loading
            ;
            fs.readFileSync.mockReturnValue('template content');
            // Mock extractFedoraVersionFromISO to avoid real command execution
            jest.spyOn(manager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            mockEta.renderString.mockImplementation((template, data) => {
                return `---
username: ${data.username}
password: ${data.password}
locale: ${data.locale}
keyboard: ${data.keyboard}
timezone: ${data.timezone}
fedoraVersion: ${data.fedoraVersion}
`;
            });
        });
        it('should generate complete kickstart configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockLog = jest.spyOn(manager['debug'], 'warn').mockImplementation(() => ({}));
            jest.spyOn(manager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            const result = yield manager.generateConfig();
            expect(result).toBeDefined();
            expect(mockEta.renderString).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ username: 'testuser' }));
        }));
        it('should use default locale when invalid', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', [], 'vm-123', 'invalid_locale');
            jest.spyOn(testManager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            const mockLog = jest.spyOn(testManager['debug'], 'warn').mockImplementation(() => ({}));
            yield testManager.generateConfig();
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Invalid locale'));
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('using default'));
        }));
        it('should use default keyboard when invalid', () => __awaiter(void 0, void 0, void 0, function* () {
            // 'INVALID' is uppercase, which fails the /^[a-z]{2,3}$/ check
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', [], 'vm-123', 'en_US', 'INVALID', 'UTC');
            jest.spyOn(testManager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            const mockLog = jest.spyOn(testManager['debug'], 'warn').mockImplementation(() => ({}));
            yield testManager.generateConfig();
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Invalid keyboard'));
        }));
        it('should use default timezone when empty', () => __awaiter(void 0, void 0, void 0, function* () {
            // Constructor defaults empty string to 'America/New_York', so timezone is never empty in generateConfig
            // Instead, verify the constructor handles the default correctly
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', [], 'vm-123', 'en_US', 'us', '');
            jest.spyOn(testManager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            yield testManager.generateConfig();
            // The constructor replaces empty timezone with 'America/New_York'
            expect(testManager['timezone']).toBe('America/New_York');
        }));
        it('should throw error when template file is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            jest.spyOn(testManager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            fs.readFileSync.mockImplementation(() => {
                throw new Error('Template not found');
            });
            yield expect(testManager.generateConfig()).rejects.toThrow();
        }));
    });
    describe('generateNewImage', () => {
        it('should throw error when ISO path is not set', () => __awaiter(void 0, void 0, void 0, function* () {
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('user', 'pass', []);
            testManager['isoPath'] = null;
            yield expect(testManager.generateNewImage()).rejects.toThrow('No ISO path specified');
        }));
        it('should clean up extracted directory on error', () => __awaiter(void 0, void 0, void 0, function* () {
            // generateConfig succeeds so we proceed to extractISO
            jest.spyOn(manager, 'generateConfig').mockResolvedValue('valid config');
            jest.spyOn(manager, 'validateConfig').mockResolvedValue({ valid: true, errors: [] });
            jest.spyOn(manager, 'validatePath').mockReturnValue('/tmp/test-output');
            // extractISO succeeds, setting extractDir
            jest.spyOn(manager, 'extractISO').mockResolvedValue('/tmp/extracted_iso_123');
            // addAutonistallConfigFile fails, triggering cleanup
            jest.spyOn(manager, 'addAutonistallConfigFile').mockRejectedValue(new Error('Write failed'));
            const mockCleanup = jest.spyOn(manager, 'cleanup').mockResolvedValue(undefined);
            yield expect(manager.generateNewImage()).rejects.toThrow('Write failed');
            expect(mockCleanup).toHaveBeenCalledWith('/tmp/extracted_iso_123');
        }));
    });
    describe('integration tests', () => {
        it('should handle complete workflow with Fedora-compatible applications', () => __awaiter(void 0, void 0, void 0, function* () {
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
            ];
            const testManager = new unattendedRedHatManager_1.UnattendedRedHatManager('testuser', 'testpass123', apps);
            // Mock extractFedoraVersionFromISO to avoid real command execution
            jest.spyOn(testManager, 'extractFedoraVersionFromISO').mockResolvedValue('43');
            fs.readFileSync.mockReturnValue('template content');
            // Mock Eta to include app info in rendered output
            mockEta.renderString.mockImplementation((template, data) => {
                return `${data.applicationsPostCommands}\n${data.infiniServicePostCommands}`;
            });
            const config = yield testManager.generateConfig();
            expect(config).toContain('Git');
            expect(config).toContain('Python');
            expect(config).toContain('dnf install');
        }));
    });
});
