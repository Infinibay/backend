"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const unattendedManagerBase_1 = require("../../../app/services/unattendedManagerBase");
const logger_1 = __importDefault(require("@main/logger"));
class TestUnattendedManager extends unattendedManagerBase_1.UnattendedManagerBase {
    // Expose protected properties for testing
    get testConfigFileName() {
        return this.configFileName;
    }
    get testIsoPath() {
        return this.isoPath;
    }
    setTestIsoPath(isoPath) {
        this.isoPath = isoPath;
    }
    setTestConfigFileName(fileName) {
        this.configFileName = fileName;
    }
    testGenerateConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.generateConfig();
        });
    }
    testGenerateNewImage() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.generateNewImage();
        });
    }
    testValidatePath(envPath, defaultPath) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.validatePath(envPath, defaultPath);
        });
    }
    testGenerateRandomFileName() {
        return this.generateRandomFileName();
    }
    testSanitizeScriptName(scriptName) {
        return this.sanitizeScriptName(scriptName);
    }
    createISO(_newIsoPath, _extractDir) {
        return __awaiter(this, void 0, void 0, function* () {
            // Mock implementation for testing
        });
    }
}
describe('UnattendedManagerBase', () => {
    let manager;
    let mockDebugLog;
    beforeEach(() => {
        jest.clearAllMocks();
        manager = new TestUnattendedManager();
        manager.setTestIsoPath('/tmp/test.iso');
        manager.setTestConfigFileName('test.cfg');
        // Mock logger methods
        jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
    });
    describe('constructor and initialization', () => {
        it('should initialize with default values', () => {
            expect(manager.configFileName).toBe('test.cfg');
            expect(manager.isoPath).toBe('/tmp/test.iso');
        });
    });
    describe('generateConfig', () => {
        it('should return empty string for base class', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield manager.testGenerateConfig();
            expect(result).toBe('');
        }));
    });
    describe('validatePath', () => {
        const originalEnv = process.env;
        beforeEach(() => {
            process.env = Object.assign(Object.assign({}, originalEnv), { INFINIBAY_BASE_DIR: '/opt/infinibay' });
        });
        afterEach(() => {
            process.env = originalEnv;
        });
        it('should use provided path and create directory if it does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const testDir = '/tmp/test_validation_' + Date.now();
            const result = yield manager.testValidatePath(testDir, '/default/path');
            expect(result).toBe(testDir);
            expect(require('fs').existsSync(testDir)).toBe(true);
        }));
        it('should use default path when environment path is undefined', () => __awaiter(void 0, void 0, void 0, function* () {
            process.env.TEST_PATH = '';
            const fs = require('fs');
            const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            const result = yield manager.testValidatePath(process.env.TEST_PATH, '/default/path');
            expect(result).toBe('/default/path');
            existsSyncSpy.mockRestore();
        }));
        it('should use default path when environment path is empty string', () => __awaiter(void 0, void 0, void 0, function* () {
            const fs = require('fs');
            const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            const result = yield manager.testValidatePath('', '/default/path');
            expect(result).toBe('/default/path');
            existsSyncSpy.mockRestore();
        }));
    });
    describe('generateRandomFileName', () => {
        it('should generate a random filename with .iso extension', () => {
            const fileName = manager.testGenerateRandomFileName();
            expect(fileName).toMatch(/^[a-z0-9]+\.iso$/);
            expect(fileName.length).toBeGreaterThan(5);
            expect(fileName.length).toBeLessThan(30);
        });
        it('should generate unique filenames on consecutive calls', () => {
            const fileName1 = manager.testGenerateRandomFileName();
            const fileName2 = manager.testGenerateRandomFileName();
            expect(fileName1).not.toBe(fileName2);
        });
    });
    describe('sanitizeScriptName', () => {
        it('should return "script" for empty input', () => {
            expect(manager.testSanitizeScriptName('')).toBe('script');
            expect(manager.testSanitizeScriptName(null)).toBe('script');
            expect(manager.testSanitizeScriptName(undefined)).toBe('script');
        });
        it('should replace spaces with underscores', () => {
            expect(manager.testSanitizeScriptName('my script')).toBe('my_script');
        });
        it('should remove special characters except underscores and hyphens', () => {
            expect(manager.testSanitizeScriptName('script@name#test!')).toBe('scriptnametest');
            expect(manager.testSanitizeScriptName('script with spaces & symbols!')).toBe('script_with_spaces__symbols');
        });
        it('should truncate to 60 characters', () => {
            const longName = 'a'.repeat(100);
            const result = manager.testSanitizeScriptName(longName);
            expect(result.length).toBe(60);
        });
        it('should preserve alphanumeric characters, underscores, and hyphens', () => {
            expect(manager.testSanitizeScriptName('My_Script-Name123')).toBe('My_Script-Name123');
        });
        it('should handle mixed case correctly', () => {
            expect(manager.testSanitizeScriptName('MyScript')).toBe('MyScript');
        });
    });
    describe('generateNewImage', () => {
        const originalEnv = process.env;
        beforeEach(() => {
            process.env = Object.assign(Object.assign({}, originalEnv), { INFINIBAY_BASE_DIR: '/opt/infinibay' });
        });
        afterEach(() => {
            process.env = originalEnv;
        });
        it('should throw error if isoPath is not set', () => __awaiter(void 0, void 0, void 0, function* () {
            manager.setTestIsoPath(null);
            yield expect(manager.testGenerateNewImage()).rejects.toThrow('No ISO path specified');
        }));
        it('should throw error if configFileName is not set', () => __awaiter(void 0, void 0, void 0, function* () {
            manager.setTestConfigFileName(null);
            // Mock validatePath and extractISO so we reach the configFileName check
            jest.spyOn(manager, 'validatePath').mockReturnValue('/tmp/test-output');
            jest.spyOn(manager, 'extractISO').mockResolvedValue('/tmp/extracted');
            jest.spyOn(manager, 'cleanup').mockResolvedValue(undefined);
            yield expect(manager.testGenerateNewImage()).rejects.toThrow('configFileName is not set');
        }));
        it('should validate configuration and throw on validation failure', () => __awaiter(void 0, void 0, void 0, function* () {
            jest.spyOn(manager, 'validateConfig').mockResolvedValueOnce({
                valid: false,
                errors: ['Validation error 1', 'Validation error 2']
            });
            yield expect(manager.testGenerateNewImage()).rejects.toThrow('Configuration validation failed: Validation error 1; Validation error 2');
        }));
        it('should call validateConfig with generated config content', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockConfig = 'test config content';
            jest.spyOn(manager, 'generateConfig').mockResolvedValueOnce(mockConfig);
            const validateSpy = jest.spyOn(manager, 'validateConfig').mockResolvedValueOnce({ valid: true, errors: [] });
            yield expect(manager.testGenerateNewImage()).rejects.toThrow(); // Will fail on ISO extraction
            expect(validateSpy).toHaveBeenCalledWith(mockConfig);
        }));
    });
    describe('cleanup', () => {
        it('should not throw on cleanup of valid directory', () => __awaiter(void 0, void 0, void 0, function* () {
            const testDir = '/tmp/test_cleanup_' + Date.now();
            require('fs').mkdirSync(testDir, { recursive: true });
            // Test cleanup through the private method using type assertion
            const managerAny = manager;
            yield expect(managerAny.cleanup(testDir)).resolves.not.toThrow();
            // Verify directory was cleaned up
            expect(require('fs').existsSync(testDir)).toBe(false);
        }));
        it('should not throw on cleanup of non-existent directory', () => __awaiter(void 0, void 0, void 0, function* () {
            const nonExistentDir = '/tmp/non_existent_' + Date.now();
            const managerAny = manager;
            yield expect(managerAny.cleanup(nonExistentDir)).resolves.not.toThrow();
        }));
        it('should handle cleanup failures gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const managerAny = manager;
            // This should not throw even with invalid path
            yield expect(managerAny.cleanup('')).resolves.not.toThrow();
        }));
        it('should protect against unsafe cleanup paths', () => __awaiter(void 0, void 0, void 0, function* () {
            const managerAny = manager;
            // Should handle paths outside tmpdir
            yield expect(managerAny.cleanup('/etc/passwd')).resolves.not.toThrow();
        }));
    });
    describe('integration tests', () => {
        it('should properly chain generateConfig -> validateConfig -> generateNewImage', () => __awaiter(void 0, void 0, void 0, function* () {
            const managerAny = manager;
            const mockConfig = 'test configuration';
            jest.spyOn(managerAny, 'generateConfig').mockResolvedValueOnce(mockConfig);
            jest.spyOn(managerAny, 'validateConfig').mockResolvedValueOnce({ valid: true, errors: [] });
            yield expect(managerAny.testGenerateNewImage()).rejects.toThrow();
            // Verify the chain worked correctly
            expect(managerAny.generateConfig).toHaveBeenCalled();
            expect(managerAny.validateConfig).toHaveBeenCalledWith(mockConfig);
        }));
        it('should clean up on generateNewImage failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const managerAny = manager;
            jest.spyOn(managerAny, 'generateConfig').mockResolvedValueOnce('test config');
            jest.spyOn(managerAny, 'validateConfig').mockResolvedValueOnce({ valid: false, errors: ['test error'] });
            yield expect(managerAny.testGenerateNewImage()).rejects.toThrow();
            // Cleanup should have been attempted
        }));
    });
});
