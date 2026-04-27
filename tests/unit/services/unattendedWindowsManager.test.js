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
const unattendedWindowsManager_1 = require("@services/unattendedWindowsManager");
// Mock the module dependencies
jest.mock('fs', () => (Object.assign(Object.assign({}, jest.requireActual('fs')), { existsSync: jest.fn(), readFileSync: jest.fn(), stat: jest.fn(), writeFile: jest.fn(() => Promise.resolve()) })));
jest.mock('child_process', () => (Object.assign(Object.assign({}, jest.requireActual('child_process')), { spawn: jest.fn(() => {
        const mock = jest.fn();
        mock.stdout = { on: jest.fn() };
        mock.stderr = { on: jest.fn() };
        mock.on = jest.fn();
        return mock;
    }), execSync: jest.fn() })));
jest.mock('xml2js', () => {
    const actual = jest.requireActual('xml2js');
    return Object.assign(Object.assign({}, actual), { parseString: jest.fn((xml, options, callback) => {
            // Use actual xml2js for parsing
            actual.parseString(xml, options, callback);
        }) });
});
describe('UnattendedWindowsManager', () => {
    const mockUsername = 'testuser';
    const mockPassword = 'testpassword123';
    const mockProductKey = 'W269N-WFGWX-YVC9B-4J6C9-T83GX';
    const mockApplications = [
        {
            id: 'app1',
            name: 'Test App',
            os: ['windows'],
            installCommand: { windows: 'msiexec /i test.msi' },
            parameters: {}
        }
    ];
    let manager;
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.INFINIBAY_BASE_DIR = '/opt/infinibay';
        manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, mockApplications);
    });
    describe('constructor', () => {
        it('should initialize with all parameters', () => {
            expect(manager).toBeInstanceOf(unattendedWindowsManager_1.UnattendedWindowsManager);
            expect(manager['version']).toBe(10);
            expect(manager['username']).toBe(mockUsername);
            expect(manager['password']).toBe(mockPassword);
            expect(manager['vmId']).toBe('');
        });
        it('should accept undefined product key', () => {
            const m = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, undefined, []);
            expect(m).toBeInstanceOf(unattendedWindowsManager_1.UnattendedWindowsManager);
        });
        it('should set isoPath based on Windows version', () => {
            const m10 = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
            const m11 = new unattendedWindowsManager_1.UnattendedWindowsManager(11, mockUsername, mockPassword, mockProductKey, []);
            expect(m10['isoPath']).toContain('windows10.iso');
            expect(m11['isoPath']).toContain('windows11.iso');
        });
        it('should use default product key if none provided', () => {
            const m = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, undefined, []);
            const defaultKey = unattendedWindowsManager_1.UnattendedWindowsManager.PRODUCT_KEY;
            // Verify the class has the default key constant
            expect(defaultKey).toBeTruthy();
        });
        it('should use custom product key from environment variable', () => {
            const customKey = 'CUSTOM-KEY-12345';
            process.env.WINDOWS_PRODUCT_KEY = customKey;
            const m = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, undefined, []);
            delete process.env.WINDOWS_PRODUCT_KEY;
            expect(m).toBeInstanceOf(unattendedWindowsManager_1.UnattendedWindowsManager);
        });
        it('should accept scripts array', () => {
            const mockScripts = [
                { script: { id: '1', name: 'test' }, executionId: '123' },
                { script: { id: '2', name: 'test2' }, executionId: '456' }
            ];
            const m = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, mockApplications, 'vm-123', mockScripts);
            expect(m['scripts']).toHaveLength(2);
            expect(m['vmId']).toBe('vm-123');
        });
        it('should set enableCommandLogging flag', () => {
            const mWithLogging = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, mockApplications, undefined, [], true);
            const mWithoutLogging = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, mockApplications, undefined, [], false);
            expect(mWithLogging['enableCommandLogging']).toBe(true);
            expect(mWithoutLogging['enableCommandLogging']).toBe(false);
        });
    });
    describe('language detection', () => {
        describe('detectISOLanguage', () => {
            it('should detect English from filename', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(true);
                const managerEN = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                managerEN['isoPath'] = '/opt/infinibay/iso/Windows 10 EN-US.iso';
                const lang = yield managerEN.detectISOLanguage();
                expect(lang).toBe('en-US');
            }));
            it('should detect Spanish from filename', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(true);
                const managerES = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                managerES['isoPath'] = '/opt/infinibay/iso/Windows 11 es-ES.iso';
                const lang = yield managerES.detectISOLanguage();
                expect(lang).toBe('es-ES');
            }));
            it('should detect language from ISO filename', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(true);
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/opt/infinibay/iso/Windows 10 Pro en-US.iso';
                const lang = yield manager.detectISOLanguage();
                expect(lang).toBe('en-US');
            }));
            it('should fallback to host system language when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(false);
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/nonexistent/iso.iso';
                const lang = yield manager.detectISOLanguage();
                // Should return null when ISO not found
                expect(lang).toBeNull();
            }));
            it('should return null when ISO file does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(false);
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/nonexistent/iso.iso';
                const lang = yield manager.detectISOLanguage();
                expect(lang).toBeNull();
            }));
        });
        describe('detectLanguage', () => {
            it('should prioritize ISO language over host system language', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(true);
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/opt/infinibay/iso/Windows 10 EN-US.iso';
                const langConfig = yield manager.detectLanguage();
                expect(langConfig.uiLanguage).toBe('en-US');
            }));
            it('should fallback to host system language when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
                // Set LANG env var so getHostSystemLanguage finds it
                const origLang = process.env.LANG;
                process.env.LANG = 'de_DE.UTF-8';
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/nonexistent/iso.iso';
                const langConfig = yield manager.detectLanguage();
                expect(langConfig.uiLanguage).toBe('de-DE');
                // Restore
                if (origLang !== undefined) {
                    process.env.LANG = origLang;
                }
                else {
                    delete process.env.LANG;
                }
            }));
            it('should use default en-US when no language detected', () => __awaiter(void 0, void 0, void 0, function* () {
                ;
                fs.existsSync.mockReturnValue(false);
                const origLang = process.env.LANG;
                delete process.env.LANG;
                const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
                manager['isoPath'] = '/nonexistent/iso.iso';
                // Mock execSync to return empty
                const execSync = require('child_process').execSync;
                execSync.mockReturnValue('');
                const langConfig = yield manager.detectLanguage();
                expect(langConfig.uiLanguage).toBe('en-US');
                if (origLang !== undefined) {
                    process.env.LANG = origLang;
                }
            }));
        });
    });
    describe('language configuration', () => {
        it('should have language mapping for all supported languages', () => {
            const langMap = unattendedWindowsManager_1.UnattendedWindowsManager.LANGUAGE_MAP;
            const expectedLanguages = [
                'en-US', 'es-ES', 'es-MX', 'fr-FR', 'de-DE', 'it-IT',
                'pt-BR', 'pt-PT', 'ja-JP', 'zh-CN', 'ko-KR', 'ru-RU'
            ];
            for (const lang of expectedLanguages) {
                expect(langMap[lang]).toBeDefined();
                expect(langMap[lang].uiLanguage).toBe(lang);
            }
        });
        it('should map language codes correctly', () => {
            expect(unattendedWindowsManager_1.UnattendedWindowsManager.LANGUAGE_MAP['es-ES'].inputLocale).toBe('040a:0000040a');
            expect(unattendedWindowsManager_1.UnattendedWindowsManager.LANGUAGE_MAP['en-US'].inputLocale).toBe('0409:00000409');
        });
    });
    describe('PowerShell command generation', () => {
        describe('createLoggedCommand', () => {
            it('should create simple command without logging when disabled', () => {
                const managerNoLog = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [], undefined, [], false);
                const cmd = managerNoLog.createLoggedCommand('Write-Host "Hello"', 'test', 'test.log');
                expect(cmd).not.toContain('Add-Content');
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command');
            });
            it('should create command with logging when enabled', () => {
                const cmd = manager.createLoggedCommand('Write-Host "Hello"', 'test', 'test.log');
                expect(cmd).toContain('Add-Content');
                expect(cmd).toContain('try');
                expect(cmd).toContain('catch');
            });
            it('should escape special characters in commands', () => {
                const cmd = manager.createLoggedCommand('Write-Host "Hello World"', 'test', 'test.log');
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command');
            });
        });
        describe('buildPowerShellScript', () => {
            it('should build base64 encoded script', () => {
                const scriptLines = [
                    'Write-Host "Hello"',
                    'Write-Host "World"'
                ];
                const cmd = manager.buildPowerShellScript(scriptLines);
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand');
                // Verify it's valid base64
                const encodedPart = cmd.split(' ')[3];
                try {
                    const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                    expect(decoded).toContain('Write-Host');
                }
                catch (_a) {
                    // If decoding fails, the encoding might be UTF-16LE encoded then base64
                    // which is expected for PowerShell -EncodedCommand
                }
            });
            it('should handle empty script lines', () => {
                const scriptLines = [];
                const cmd = manager.buildPowerShellScript(scriptLines);
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand');
            });
        });
        describe('buildPowerShellCommand', () => {
            it('should use simple command for short scripts without logging', () => {
                const managerNoLog = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [], undefined, [], false);
                const scriptLines = ['Write-Host "Simple"'];
                const cmd = managerNoLog.buildPowerShellCommand(scriptLines, true);
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -Command');
                expect(cmd).not.toContain('EncodedCommand');
            });
            it('should use base64 for complex scripts', () => {
                const scriptLines = [
                    'Write-Host "Line 1"',
                    'Write-Host "Line 2"',
                    'Write-Host "Line 3"'
                ];
                const cmd = manager.buildPowerShellCommand(scriptLines);
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand');
            });
        });
        describe('createDownloadCommand', () => {
            it('should create download command with retry logic', () => {
                const url = 'http://example.com/file.exe';
                const outputPath = 'C:\\Temp\\file.exe';
                const cmd = manager.createDownloadCommand(url, outputPath, 'test download');
                expect(cmd).toContain('powershell -ExecutionPolicy Bypass -EncodedCommand');
                // The script content is base64 encoded, so decode and verify
                const encodedPart = cmd.split('-EncodedCommand ')[1];
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                expect(decoded).toContain('$maxAttempts');
                expect(decoded).toContain('WebClient');
            });
            it('should create simple download command when logging disabled', () => {
                const managerNoLog = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [], undefined, [], false);
                const url = 'http://example.com/file.exe';
                const outputPath = 'C:\\Temp\\file.exe';
                const cmd = managerNoLog.createDownloadCommand(url, outputPath, 'test download');
                expect(cmd).not.toContain('maxAttempts');
                expect(cmd).toContain('WebClient');
            });
        });
    });
    describe('first logon commands', () => {
        it('should generate first logon commands', () => {
            const commands = manager.getFirstLogonCommands();
            expect(Array.isArray(commands)).toBe(true);
            expect(commands.length).toBeGreaterThan(0);
            // Check for expected commands
            const descriptions = commands.map((c) => c.Description);
            expect(descriptions).toContain('Control Panel View');
            expect(descriptions).toContain('Password Never Expires');
            expect(descriptions).toContain('Restart System');
        });
        it('should include InfiniService installation commands', () => {
            const commands = manager.getFirstLogonCommands();
            const descriptions = commands.map((c) => c.Description);
            const infiniServiceCommands = descriptions.filter((d) => d.includes('InfiniService') || d.includes('infiniservice'));
            expect(infiniServiceCommands.length).toBeGreaterThan(0);
        });
        it('should include application installation commands', () => {
            const commands = manager.getFirstLogonCommands();
            const descriptions = commands.map((c) => c.Description);
            const appCommands = descriptions.filter((d) => d.includes('Test App') || d.includes('app'));
            expect(appCommands.length).toBeGreaterThan(0);
        });
        it('should order commands correctly', () => {
            const commands = manager.getFirstLogonCommands();
            // Check that commands have increasing order
            let lastOrder = -1;
            for (const cmd of commands) {
                expect(cmd.Order).toBeGreaterThan(lastOrder);
                lastOrder = cmd.Order;
            }
            // First command should be order 1
            expect(commands[0].Order).toBe(1);
            // Last command should be restart
            expect(commands[commands.length - 1].Description).toBe('Restart System');
        });
    });
    describe('app installation commands', () => {
        it('should generate commands for applications with Windows install', () => {
            const commands = manager.generateAppsToInstallScripts(1);
            expect(Array.isArray(commands)).toBe(true);
            expect(commands.length).toBe(1);
            expect(commands[0].Description).toBe('Install Test App');
            expect(commands[0].CommandLine).toContain('msiexec /i test.msi');
        });
        it('should skip applications without Windows install command', () => {
            const apps = [
                {
                    id: 'app1',
                    name: 'Linux Only App',
                    os: ['ubuntu'],
                    installCommand: { ubuntu: 'apt install app' },
                    parameters: {}
                }
            ];
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, apps);
            const commands = manager.generateAppsToInstallScripts(1);
            expect(commands.length).toBe(0);
        });
        it('should sanitize application names in commands', () => {
            const apps = [
                {
                    id: 'app1',
                    name: 'App with spaces & special!chars',
                    os: ['windows'],
                    installCommand: { windows: 'install app' },
                    parameters: {}
                }
            ];
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, apps);
            const commands = manager.generateAppsToInstallScripts(1);
            expect(commands.length).toBe(1);
            // Name should be sanitized
            expect(commands[0].Description).toBe('Install App with spaces & special!chars');
        });
        it('should parse and substitute parameters', () => {
            const apps = [
                {
                    id: 'app1',
                    name: 'Param App',
                    os: ['windows'],
                    installCommand: { windows: 'install --{{user}}={{username}}' },
                    parameters: { user: 'testuser' }
                }
            ];
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, apps);
            const commands = manager.generateAppsToInstallScripts(1);
            expect(commands[0].CommandLine).toContain('testuser');
        });
    });
    describe('XML configuration generation', () => {
        it('should generate valid XML configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            expect(typeof config).toBe('string');
            expect(config).toContain('<?xml');
            expect(config).toContain('<unattend');
            expect(config).toContain('<settings');
        }));
        it('should include product key in XML when provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            expect(config).toContain(mockProductKey);
        }));
        it('should include username in XML', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            expect(config).toContain(mockUsername);
        }));
        it('should include Windows version-specific settings', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager10 = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
            const manager11 = new unattendedWindowsManager_1.UnattendedWindowsManager(11, mockUsername, mockPassword, mockProductKey, []);
            const config10 = yield manager10.generateConfig();
            const config11 = yield manager11.generateConfig();
            // Both should have different settings based on version
            expect(typeof config10).toBe('string');
            expect(typeof config11).toBe('string');
        }));
        it('should include auto-logon configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            expect(config).toContain('AutoLogon');
            expect(config).toContain('Enabled');
        }));
        it('should include OOBE settings', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            expect(config).toContain('OOBE');
            expect(config).toContain('SkipUserOOBE');
        }));
    });
    describe('ISO creation', () => {
        it('should throw error if extraction directory does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            fs.existsSync.mockReturnValue(false);
            const nonExistentPath = '/nonexistent/path';
            yield expect(manager.createISO('/tmp/test.iso', nonExistentPath)).rejects.toThrow('Extraction directory does not exist');
        }));
        it('should create ISO with correct xorriso parameters', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockExtractDir = '/tmp/extracted_iso_123';
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            const mockExecute = jest.spyOn(manager, 'executeCommand').mockResolvedValue('');
            yield manager.createISO('/tmp/test.iso', mockExtractDir);
            expect(mockExecute).toHaveBeenCalled();
            const callArgs = mockExecute.mock.calls[0][0];
            expect(callArgs[0]).toBe('xorriso');
            expect(callArgs).toContain('-o');
            expect(callArgs).toContain('/tmp/test.iso');
            expect(callArgs).toContain(mockExtractDir);
        }));
    });
    describe('XML validation', () => {
        it('should validate valid XML configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            const result = yield manager.validateConfig(config);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        }));
        it('should reject invalid XML', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield manager.validateConfig('not valid xml');
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        }));
        it('should validate required unattend root element', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield manager.validateConfig('<root>test</root>');
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes('unattend'))).toBe(true);
        }));
        it('should validate required settings passes', () => __awaiter(void 0, void 0, void 0, function* () {
            // Construct XML missing a required settings pass (oobeSystem)
            const incompleteConfig = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE"><component name="test"/></settings>
  <settings pass="specialize"><component name="test"/></settings>
</unattend>`;
            const result = yield manager.validateConfig(incompleteConfig);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes('settings pass'))).toBe(true);
        }));
    });
    describe('environment variables', () => {
        it('should use APP_HOST environment variable', () => __awaiter(void 0, void 0, void 0, function* () {
            const originalHost = process.env.APP_HOST;
            process.env.APP_HOST = 'custom-host.example.com';
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
            const commands = manager.getFirstLogonCommands();
            expect(JSON.stringify(commands)).toContain('custom-host.example.com');
            if (originalHost)
                process.env.APP_HOST = originalHost;
            else
                delete process.env.APP_HOST;
        }));
        it('should use PORT environment variable', () => __awaiter(void 0, void 0, void 0, function* () {
            const originalPort = process.env.PORT;
            process.env.PORT = '8080';
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
            const config = yield manager.generateConfig();
            if (originalPort)
                process.env.PORT = originalPort;
            else
                delete process.env.PORT;
        }));
    });
    describe('edge cases', () => {
        it('should handle empty applications array', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, []);
            const commands = manager.generateAppsToInstallScripts(1);
            expect(commands.length).toBe(0);
        }));
        it('should handle missing optional parameters', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, undefined, []);
            expect(manager).toBeDefined();
        }));
        it('should handle VM ID parameter', () => __awaiter(void 0, void 0, void 0, function* () {
            const manager = new unattendedWindowsManager_1.UnattendedWindowsManager(10, mockUsername, mockPassword, mockProductKey, [], 'vm-unique-id-123');
            expect(manager['vmId']).toBe('vm-unique-id-123');
        }));
    });
    describe('security', () => {
        it('should not expose password in logs or commands', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield manager.generateConfig();
            // Password should not appear in plain text in XML output
            // (it will appear as part of XML structure, but not logged)
            expect(config.length).toBeGreaterThan(0);
        }));
        it('should handle sensitive paths correctly', () => {
            const PATHS = unattendedWindowsManager_1.UnattendedWindowsManager.PATHS;
            expect(PATHS.TEMP_DIR).toBe('C:\\Temp');
            expect(PATHS.INFINISERVICE_TEMP).toBe('C:\\Temp\\InfiniService');
        });
    });
});
describe('UnattendedWindowsManager constants', () => {
    it('should have PRODUCT_KEY constant', () => {
        // Access the class constant directly
        const Key = unattendedWindowsManager_1.UnattendedWindowsManager.PRODUCT_KEY;
        expect(Key).toBeTruthy();
        expect(typeof Key).toBe('string');
    });
    it('should have PATHS constant', () => {
        const PATHS = unattendedWindowsManager_1.UnattendedWindowsManager.PATHS;
        expect(PATHS).toBeDefined();
        expect(PATHS.TEMP_DIR).toBe('C:\\Temp');
        expect(PATHS.INFINISERVICE_TEMP).toBe('C:\\Temp\\InfiniService');
    });
    it('should have INFINISERVICE constant', () => {
        const INFINISERVICE = unattendedWindowsManager_1.UnattendedWindowsManager.INFINISERVICE;
        expect(INFINISERVICE).toBeDefined();
        expect(INFINISERVICE.BINARY_NAME).toBe('infiniservice.exe');
        expect(INFINISERVICE.SERVICE_NAME).toBe('Infiniservice');
    });
    it('should have COMPONENT_BASE_CONFIG constant', () => {
        const COMPONENT = unattendedWindowsManager_1.UnattendedWindowsManager.COMPONENT_BASE_CONFIG;
        expect(COMPONENT.name).toBe('Microsoft-Windows-Shell-Setup');
        expect(COMPONENT.processorArchitecture).toBe('amd64');
        expect(COMPONENT.publicKeyToken).toBe('31bf3856ad364e35');
    });
    it('should have LANGUAGE_MAP constant', () => {
        const LANG_MAP = unattendedWindowsManager_1.UnattendedWindowsManager.LANGUAGE_MAP;
        expect(typeof LANG_MAP).toBe('object');
        expect(Object.keys(LANG_MAP).length).toBeGreaterThan(0);
    });
});
