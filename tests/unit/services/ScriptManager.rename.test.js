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
// @ts-nocheck
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const ScriptManager_1 = require("../../../app/services/scripts/ScriptManager");
const promises_1 = __importDefault(require("fs/promises"));
// Mock dependencies
globals_1.jest.mock('fs/promises');
// Mock Prisma enums before importing
globals_1.jest.mock('@prisma/client', () => ({
    PrismaClient: globals_1.jest.fn(),
    OS: {
        LINUX: 'LINUX',
        WINDOWS: 'WINDOWS',
        MACOS: 'MACOS'
    },
    ShellType: {
        BASH: 'BASH',
        SH: 'SH',
        POWERSHELL: 'POWERSHELL',
        CMD: 'CMD',
        ZSH: 'ZSH'
    },
    ScriptStatus: {
        PENDING: 'PENDING',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED'
    }
}));
(0, globals_1.describe)('ScriptManager - File Rename Operations', () => {
    let scriptManager;
    let mockPrisma;
    let mockFs;
    // Test data
    const mockExistingScript = {
        id: 'test-script-id',
        name: 'Old Script Name',
        fileName: 'old-script-name.yaml',
        description: 'Test script',
        category: 'test',
        tags: [],
        os: ['windows'],
        shell: 'powershell',
        status: 'APPROVED',
        approvedById: null,
        approvedAt: null,
        createdById: 'user-123',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    const validScriptContent = `name: New Script Name
description: Test script
os: [windows]
shell: powershell
script: |
  Write-Host "Test"
`;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        // Mock fs functions with default behavior
        // By default: source file exists, target doesn't exist (no collision)
        mockFs = promises_1.default;
        mockFs.access = globals_1.jest.fn((path) => {
            // Source file (old-script-name.yaml) exists
            if (path.includes('old-script-name')) {
                return Promise.resolve();
            }
            // Target file doesn't exist (no collision)
            return Promise.reject(new Error('File not found'));
        });
        mockFs.rename = globals_1.jest.fn().mockResolvedValue(undefined);
        mockFs.writeFile = globals_1.jest.fn().mockResolvedValue(undefined);
        mockFs.readFile = globals_1.jest.fn().mockResolvedValue(validScriptContent);
        // Mock Prisma
        mockPrisma = {
            script: {
                findUnique: globals_1.jest.fn(),
                update: globals_1.jest.fn(),
                create: globals_1.jest.fn(),
                delete: globals_1.jest.fn()
            },
            scriptAuditLog: {
                create: globals_1.jest.fn().mockResolvedValue({})
            }
        };
        scriptManager = new ScriptManager_1.ScriptManager(mockPrisma);
    });
    (0, globals_1.afterEach)(() => {
        ScriptManager_1.ScriptManager.dispose();
    });
    (0, globals_1.describe)('updateScript - Name Change and File Rename', () => {
        (0, globals_1.it)('should rename file when name changes', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'New Script Name', fileName: 'new-script-name.yaml' }));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            const result = yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify file rename was called
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledWith(globals_1.expect.stringContaining('old-script-name.yaml'), globals_1.expect.stringContaining('new-script-name.yaml'));
            // Verify database was updated with new fileName
            (0, globals_1.expect)(mockPrisma.script.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                data: globals_1.expect.objectContaining({
                    name: 'New Script Name',
                    fileName: 'new-script-name.yaml'
                })
            }));
        }));
        (0, globals_1.it)('should handle collision with numeric suffix', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup - simulate collision where new-script-name.yaml exists but new-script-name-1.yaml doesn't
            mockFs.access.mockImplementation((path) => {
                // Original file exists
                if (path.includes('old-script-name.yaml')) {
                    return Promise.resolve();
                }
                // First collision: new-script-name.yaml exists
                if (path.includes('new-script-name.yaml') && !path.includes('new-script-name-1')) {
                    return Promise.resolve();
                }
                // new-script-name-1.yaml doesn't exist (no collision)
                return Promise.reject(new Error('File not found'));
            });
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'New Script Name', fileName: 'new-script-name-1.yaml' }));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify mockFs.access was called to check for collisions
            (0, globals_1.expect)(mockFs.access).toHaveBeenCalled();
            // Verify it renamed to the suffixed filename
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledWith(globals_1.expect.stringContaining('old-script-name.yaml'), globals_1.expect.stringContaining('new-script-name-1.yaml'));
        }));
        (0, globals_1.it)('should write content to new filename after successful rename', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'New Script Name', fileName: 'new-script-name.yaml' }));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify content was written to NEW filename, not old
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledWith(globals_1.expect.stringContaining('new-script-name.yaml'), validScriptContent, 'utf-8');
        }));
        (0, globals_1.it)('should rollback file rename if database update fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockRejectedValue(new Error('Database connection lost'));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Database connection lost');
            // Verify rollback was attempted
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledTimes(2);
            // First call: old -> new
            (0, globals_1.expect)(mockFs.rename).toHaveBeenNthCalledWith(1, globals_1.expect.stringContaining('old-script-name.yaml'), globals_1.expect.stringContaining('new-script-name.yaml'));
            // Second call: new -> old (rollback)
            (0, globals_1.expect)(mockFs.rename).toHaveBeenNthCalledWith(2, globals_1.expect.stringContaining('new-script-name.yaml'), globals_1.expect.stringContaining('old-script-name.yaml'));
        }));
        (0, globals_1.it)('should rollback file rename if content validation fails after rename', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            const invalidContent = 'invalid: [yaml: syntax';
            const updateData = {
                name: 'New Script Name',
                content: invalidContent
            };
            // Execute
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow();
            // Verify rollback was attempted
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledTimes(2);
            // Rollback to original filename
            (0, globals_1.expect)(mockFs.rename).toHaveBeenNthCalledWith(2, globals_1.expect.stringContaining('new-script-name.yaml'), globals_1.expect.stringContaining('old-script-name.yaml'));
        }));
        (0, globals_1.it)('should rollback file rename if file write fails after rename', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockFs.writeFile.mockRejectedValue(new Error('Disk full'));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Disk full');
            // Verify rollback was attempted
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledTimes(2);
        }));
        (0, globals_1.it)('should handle missing original file gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup - file doesn't exist
            mockFs.access.mockRejectedValue(new Error('File not found'));
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'New Script Name' }));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute - should not throw
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify rename was NOT called (since file didn't exist)
            (0, globals_1.expect)(mockFs.rename).not.toHaveBeenCalled();
            // Verify database was updated but fileName was NOT changed
            (0, globals_1.expect)(mockPrisma.script.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                data: globals_1.expect.not.objectContaining({
                    fileName: globals_1.expect.anything()
                })
            }));
        }));
        (0, globals_1.it)('should preserve file extension during rename', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup - test with .json extension
            const jsonScript = Object.assign(Object.assign({}, mockExistingScript), { fileName: 'old-script-name.json' });
            const validJsonContent = JSON.stringify({
                name: 'New Script Name',
                description: 'Test script',
                os: ['windows'],
                shell: 'powershell',
                script: 'Write-Host "Test"'
            });
            mockPrisma.script.findUnique.mockResolvedValue(jsonScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, jsonScript), { name: 'New Script Name', fileName: 'new-script-name.json' }));
            const updateData = {
                name: 'New Script Name',
                content: validJsonContent
            };
            // Execute
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify .json extension was preserved
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledWith(globals_1.expect.stringContaining('.json'), globals_1.expect.stringContaining('.json'));
        }));
        (0, globals_1.it)('should throw error for invalid name that sanitizes to empty string', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            const updateData = {
                name: '!!!@@@###', // Only special characters
                content: validScriptContent
            };
            // Execute & Verify
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Invalid script name');
        }));
        (0, globals_1.it)('should not rename file when name is unchanged', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(mockExistingScript);
            const updateData = {
                name: 'Old Script Name', // Same as existing
                content: validScriptContent
            };
            // Execute
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify rename was NOT called
            (0, globals_1.expect)(mockFs.rename).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should include fileName in audit log when renamed', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'New Script Name', fileName: 'new-script-name.yaml' }));
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute
            yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Verify audit log includes fileName change
            (0, globals_1.expect)(mockPrisma.scriptAuditLog.create).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                data: globals_1.expect.objectContaining({
                    details: globals_1.expect.objectContaining({
                        fileName: {
                            from: 'old-script-name.yaml',
                            to: 'new-script-name.yaml'
                        }
                    })
                })
            }));
        }));
        (0, globals_1.it)('should throw error after 100 collision attempts', () => __awaiter(void 0, void 0, void 0, function* () {
            // Setup - always return true for file exists
            mockFs.access.mockResolvedValue(undefined);
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            const updateData = {
                name: 'New Script Name',
                content: validScriptContent
            };
            // Execute & Verify
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Unable to generate unique filename after 100 attempts');
        }));
    });
});
