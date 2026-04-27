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
(0, globals_1.describe)('ScriptManager - Template Variable Validation', () => {
    let scriptManager;
    let mockPrisma;
    let mockFs;
    // Test data
    const mockExistingScript = {
        id: 'test-script-id',
        name: 'Test Script',
        fileName: 'test-script.yaml',
        description: 'Test script',
        category: 'test',
        tags: [],
        os: ['linux'],
        shell: 'bash',
        status: 'APPROVED',
        approvedById: null,
        approvedAt: null,
        createdById: 'user-123',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        // Mock fs functions
        mockFs = promises_1.default;
        mockFs.access = globals_1.jest.fn().mockRejectedValue(new Error('File not found'));
        mockFs.mkdir = globals_1.jest.fn().mockResolvedValue(undefined);
        mockFs.writeFile = globals_1.jest.fn().mockResolvedValue(undefined);
        mockFs.readFile = globals_1.jest.fn().mockResolvedValue('');
        mockFs.rename = globals_1.jest.fn().mockResolvedValue(undefined);
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
    (0, globals_1.describe)('createScript - Template Variable Validation', () => {
        (0, globals_1.it)('should succeed when inputs match template variables (valid case)', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const validContent = `name: Test Script
description: Test script with valid template variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: validContent,
                format: 'yaml'
            };
            mockPrisma.script.create.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'Test Script' }));
            // Act
            const result = yield scriptManager.createScript(createData, 'user-123');
            // Assert
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockPrisma.script.create).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should fail with error message when single undefined variable is used', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Test script with undefined template variable
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
  echo "Password: \${{ inputs.password }}"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: invalidContent,
                format: 'yaml'
            };
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.createScript(createData, 'user-123')).rejects.toThrow('Script uses undefined input variables: password');
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should fail listing multiple undefined variables', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Test script with multiple undefined variables
os: [linux]
shell: bash
inputs:
  - name: a
    label: Variable A
    type: text
    required: true
script: |
  echo "A: \${{ inputs.a }}"
  echo "B: \${{ inputs.b }}"
  echo "C: \${{ inputs.c }}"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: invalidContent,
                format: 'yaml'
            };
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.createScript(createData, 'user-123')).rejects.toThrow('Script uses undefined input variables: b, c');
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should fail when template variables exist but no inputs defined', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Test script with template variables but no inputs
os: [linux]
shell: bash
script: |
  echo "Hello, \${{ inputs.username }}"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: invalidContent,
                format: 'yaml'
            };
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.createScript(createData, 'user-123')).rejects.toThrow('Script uses undefined input variables: username');
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should succeed when inputs defined but no template variables used', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const validContent = `name: Test Script
description: Test script with inputs but no template variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, World"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: validContent,
                format: 'yaml'
            };
            mockPrisma.script.create.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'Test Script' }));
            // Act
            const result = yield scriptManager.createScript(createData, 'user-123');
            // Assert
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockPrisma.script.create).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should succeed when no inputs and no template variables', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const validContent = `name: Test Script
description: Simple test script
os: [linux]
shell: bash
script: |
  echo "Hello, World"
`;
            const createData = {
                name: 'Test Script',
                description: 'Test script',
                content: validContent,
                format: 'yaml'
            };
            mockPrisma.script.create.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'Test Script' }));
            // Act
            const result = yield scriptManager.createScript(createData, 'user-123');
            // Assert
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockPrisma.script.create).toHaveBeenCalledTimes(1);
        }));
    });
    (0, globals_1.describe)('updateScript - Template Variable Validation', () => {
        (0, globals_1.it)('should succeed when updating content with valid template variables', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const validContent = `name: Test Script
description: Updated script with valid template variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
`;
            const updateData = {
                content: validContent
            };
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { updatedAt: new Date() }));
            // Act
            const result = yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Assert
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockPrisma.script.update).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should fail when updating content with undefined variable', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Updated script with undefined variable
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
  echo "Password: \${{ inputs.password }}"
`;
            const updateData = {
                content: invalidContent
            };
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Script uses undefined input variables: password');
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.update).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should rollback file rename when content validation fails with undefined variables', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: New Script Name
description: Script with undefined variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
  echo "API Key: \${{ inputs.apiKey }}"
`;
            const updateData = {
                name: 'New Script Name',
                content: invalidContent
            };
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            // Mock file exists check: source exists, target doesn't
            // First call: check if source file exists (during rename check)
            // Second call: check if target file exists for collision check
            let accessCallCount = 0;
            mockFs.access.mockImplementation((path) => {
                accessCallCount++;
                // Source file exists
                if (path.includes('test-script.yaml')) {
                    return Promise.resolve();
                }
                // Target file doesn't exist (no collision)
                return Promise.reject(new Error('File not found'));
            });
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Script uses undefined input variables: apiKey');
            // Verify file rename was called (original rename)
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledWith(globals_1.expect.stringContaining('test-script.yaml'), globals_1.expect.stringContaining('new-script-name.yaml'));
            // Verify rollback was called (rename back to original)
            (0, globals_1.expect)(mockFs.rename).toHaveBeenCalledTimes(2);
            (0, globals_1.expect)(mockFs.rename).toHaveBeenNthCalledWith(2, globals_1.expect.stringContaining('new-script-name.yaml'), globals_1.expect.stringContaining('test-script.yaml'));
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.update).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should skip validation when updating metadata without content', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const updateData = {
                description: 'Updated description',
                category: 'updated-category'
            };
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            mockPrisma.script.update.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { description: 'Updated description', category: 'updated-category' }));
            // Act
            const result = yield scriptManager.updateScript('test-script-id', updateData, 'user-123');
            // Assert
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled(); // No content change
            (0, globals_1.expect)(mockPrisma.script.update).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should fail with multiple undefined variables in update', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Script with multiple undefined variables
os: [linux]
shell: bash
inputs:
  - name: x
    label: Variable X
    type: text
    required: true
script: |
  echo "X: \${{ inputs.x }}"
  echo "Y: \${{ inputs.y }}"
  echo "Z: \${{ inputs.z }}"
`;
            const updateData = {
                content: invalidContent
            };
            mockPrisma.script.findUnique.mockResolvedValue(mockExistingScript);
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.updateScript('test-script-id', updateData, 'user-123')).rejects.toThrow('Script uses undefined input variables: y, z');
            // Verify no file write or DB commit occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.update).not.toHaveBeenCalled();
        }));
    });
    (0, globals_1.describe)('Edge Cases', () => {
        (0, globals_1.it)('should handle duplicate template variables correctly', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange - using same variable multiple times should only report once
            const validContent = `name: Test Script
description: Script with duplicate template variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Hello, \${{ inputs.username }}"
  echo "Welcome, \${{ inputs.username }}"
  echo "User: \${{ inputs.username }}"
`;
            const createData = {
                name: 'Test Script',
                content: validContent,
                format: 'yaml'
            };
            mockPrisma.script.create.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'Test Script' }));
            // Act
            const result = yield scriptManager.createScript(createData, 'user-123');
            // Assert - should succeed
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should handle template variables with different spacing', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const validContent = `name: Test Script
description: Script with various template spacing
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
  - name: password
    label: Password
    type: password
    required: true
script: |
  echo "\${{inputs.username}}"
  echo "\${{ inputs.password }}"
  echo "\${{  inputs.username  }}"
`;
            const createData = {
                name: 'Test Script',
                content: validContent,
                format: 'yaml'
            };
            mockPrisma.script.create.mockResolvedValue(Object.assign(Object.assign({}, mockExistingScript), { name: 'Test Script' }));
            // Act
            const result = yield scriptManager.createScript(createData, 'user-123');
            // Assert - should succeed (all spacing variations should be recognized)
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(mockFs.writeFile).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should fail when mixed valid and invalid variables', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const invalidContent = `name: Test Script
description: Script with mix of valid and invalid variables
os: [linux]
shell: bash
inputs:
  - name: username
    label: Username
    type: text
    required: true
script: |
  echo "Valid: \${{ inputs.username }}"
  echo "Invalid: \${{ inputs.password }}"
  echo "Also invalid: \${{ inputs.token }}"
`;
            const createData = {
                name: 'Test Script',
                content: invalidContent,
                format: 'yaml'
            };
            // Act & Assert
            yield (0, globals_1.expect)(scriptManager.createScript(createData, 'user-123')).rejects.toThrow('Script uses undefined input variables: password, token');
            // Verify no persistence occurred
            (0, globals_1.expect)(mockFs.writeFile).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockPrisma.script.create).not.toHaveBeenCalled();
        }));
    });
});
