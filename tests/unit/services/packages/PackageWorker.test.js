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
const globals_1 = require("@jest/globals");
const PackageWorker_1 = require("../../../../app/services/packages/PackageWorker");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const os_1 = require("os");
// Mock child_process
globals_1.jest.mock('child_process', () => ({
    spawn: globals_1.jest.fn(() => ({
        stdin: { write: globals_1.jest.fn() },
        stdout: {
            on: globals_1.jest.fn(),
            once: globals_1.jest.fn((event, cb) => {
                // Simulate ready response
                setTimeout(() => cb(Buffer.from('{"ready":true}\n')), 10);
            })
        },
        stderr: { on: globals_1.jest.fn() },
        on: globals_1.jest.fn(),
        kill: globals_1.jest.fn(),
        pid: 12345
    }))
}));
(0, globals_1.describe)('PackageWorker', () => {
    let worker;
    let testDir;
    const createValidManifest = (overrides = {}) => (Object.assign({ name: 'test-package', displayName: 'Test Package', version: '1.0.0', description: 'Test package description', author: 'Test Author', license: 'open-source', checkers: [
            {
                name: 'test-checker',
                type: 'info',
                file: 'checkers/test.js',
                dataNeeds: []
            }
        ] }, overrides));
    (0, globals_1.beforeEach)(() => __awaiter(void 0, void 0, void 0, function* () {
        testDir = path_1.default.join((0, os_1.tmpdir)(), `package-worker-test-${Date.now()}`);
        yield promises_1.default.mkdir(testDir, { recursive: true });
        yield promises_1.default.mkdir(path_1.default.join(testDir, 'checkers'), { recursive: true });
        const mockManifest = createValidManifest();
        yield promises_1.default.writeFile(path_1.default.join(testDir, 'manifest.json'), JSON.stringify(mockManifest, null, 2));
        yield promises_1.default.writeFile(path_1.default.join(testDir, 'checkers/test.js'), `module.exports = {
        async analyze(context) {
          return []
        }
      }`);
        globals_1.jest.clearAllMocks();
    }));
    (0, globals_1.afterEach)(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield promises_1.default.rm(testDir, { recursive: true, force: true });
        }
        catch (_a) {
            // Ignore cleanup errors
        }
        globals_1.jest.clearAllMocks();
    }));
    (0, globals_1.describe)('Constructor', () => {
        (0, globals_1.it)('should create worker with valid manifest', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            (0, globals_1.expect)(worker).toBeInstanceOf(PackageWorker_1.PackageWorker);
        });
    });
    (0, globals_1.describe)('getName', () => {
        (0, globals_1.it)('should return the package name', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            (0, globals_1.expect)(worker.getName()).toBe('test-package');
        });
    });
    (0, globals_1.describe)('isRunning', () => {
        (0, globals_1.it)('should return false when worker is not spawned', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            (0, globals_1.expect)(worker.isRunning()).toBe(false);
        });
        (0, globals_1.it)('should return true when worker has a process', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            worker.process = { pid: 12345 };
            worker.isShuttingDown = false;
            (0, globals_1.expect)(worker.isRunning()).toBe(true);
        });
        (0, globals_1.it)('should return false when worker is shutting down', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            worker.process = { pid: 12345 };
            worker.isShuttingDown = true;
            (0, globals_1.expect)(worker.isRunning()).toBe(false);
        });
    });
    (0, globals_1.describe)('getStats', () => {
        (0, globals_1.it)('should return zero stats when not started', () => {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            const stats = worker.getStats();
            (0, globals_1.expect)(stats.uptime).toBe(0);
            (0, globals_1.expect)(stats.requestCount).toBe(0);
            (0, globals_1.expect)(stats.errorCount).toBe(0);
        });
    });
    (0, globals_1.describe)('shutdown', () => {
        (0, globals_1.it)('should handle already stopped worker', () => __awaiter(void 0, void 0, void 0, function* () {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            // No process running
            yield (0, globals_1.expect)(worker.shutdown()).resolves.not.toThrow();
        }));
    });
    (0, globals_1.describe)('analyze', () => {
        (0, globals_1.it)('should throw when worker is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            const manifest = createValidManifest();
            worker = new PackageWorker_1.PackageWorker(testDir, manifest);
            const context = {
                vmId: 'test-123',
                settings: {}
            };
            // Worker not spawned, should throw
            yield (0, globals_1.expect)(worker.analyze(context)).rejects.toThrow('Worker not running');
        }));
    });
    (0, globals_1.describe)('error handling', () => {
        (0, globals_1.it)('should handle invalid manifest format', () => {
            const invalidManifest = 'not a json';
            // This may or may not throw depending on implementation
            // The worker stores what you give it
            (0, globals_1.expect)(() => {
                new PackageWorker_1.PackageWorker(testDir, invalidManifest);
            }).not.toThrow();
        });
    });
});
