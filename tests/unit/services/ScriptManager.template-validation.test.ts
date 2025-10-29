// @ts-nocheck
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScriptManager, CreateScriptInput, UpdateScriptInput } from '../../../app/services/scripts/ScriptManager';
import { PrismaClient, Script, OS, ShellType, ScriptStatus } from '@prisma/client';
import fs from 'fs/promises';

// Mock dependencies
jest.mock('fs/promises');

// Mock Prisma enums before importing
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(),
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

describe('ScriptManager - Template Variable Validation', () => {
  let scriptManager: ScriptManager;
  let mockPrisma: any;
  let mockFs: any;

  // Test data
  const mockExistingScript: Script = {
    id: 'test-script-id',
    name: 'Test Script',
    fileName: 'test-script.yaml',
    description: 'Test script',
    category: 'test',
    tags: [],
    os: ['linux' as OS],
    shell: 'bash' as ShellType,
    status: 'APPROVED' as ScriptStatus,
    approvedById: null,
    approvedAt: null,
    createdById: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fs functions
    mockFs = fs as any;
    (mockFs.access as any) = jest.fn().mockRejectedValue(new Error('File not found'));
    (mockFs.mkdir as any) = jest.fn().mockResolvedValue(undefined);
    (mockFs.writeFile as any) = jest.fn().mockResolvedValue(undefined);
    (mockFs.readFile as any) = jest.fn().mockResolvedValue('');
    (mockFs.rename as any) = jest.fn().mockResolvedValue(undefined);

    // Mock Prisma
    mockPrisma = {
      script: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn()
      },
      scriptAuditLog: {
        create: jest.fn().mockResolvedValue({})
      }
    } as any;

    scriptManager = new ScriptManager(mockPrisma);
  });

  afterEach(() => {
    ScriptManager.dispose();
  });

  describe('createScript - Template Variable Validation', () => {
    it('should succeed when inputs match template variables (valid case)', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: validContent,
        format: 'yaml'
      };

      (mockPrisma.script.create as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'Test Script'
      });

      // Act
      const result = await scriptManager.createScript(createData, 'user-123');

      // Assert
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockPrisma.script.create).toHaveBeenCalledTimes(1);
    });

    it('should fail with error message when single undefined variable is used', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: invalidContent,
        format: 'yaml'
      };

      // Act & Assert
      await expect(
        scriptManager.createScript(createData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: password');

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.create).not.toHaveBeenCalled();
    });

    it('should fail listing multiple undefined variables', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: invalidContent,
        format: 'yaml'
      };

      // Act & Assert
      await expect(
        scriptManager.createScript(createData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: b, c');

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.create).not.toHaveBeenCalled();
    });

    it('should fail when template variables exist but no inputs defined', async () => {
      // Arrange
      const invalidContent = `name: Test Script
description: Test script with template variables but no inputs
os: [linux]
shell: bash
script: |
  echo "Hello, \${{ inputs.username }}"
`;

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: invalidContent,
        format: 'yaml'
      };

      // Act & Assert
      await expect(
        scriptManager.createScript(createData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: username');

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.create).not.toHaveBeenCalled();
    });

    it('should succeed when inputs defined but no template variables used', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: validContent,
        format: 'yaml'
      };

      (mockPrisma.script.create as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'Test Script'
      });

      // Act
      const result = await scriptManager.createScript(createData, 'user-123');

      // Assert
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockPrisma.script.create).toHaveBeenCalledTimes(1);
    });

    it('should succeed when no inputs and no template variables', async () => {
      // Arrange
      const validContent = `name: Test Script
description: Simple test script
os: [linux]
shell: bash
script: |
  echo "Hello, World"
`;

      const createData: CreateScriptInput = {
        name: 'Test Script',
        description: 'Test script',
        content: validContent,
        format: 'yaml'
      };

      (mockPrisma.script.create as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'Test Script'
      });

      // Act
      const result = await scriptManager.createScript(createData, 'user-123');

      // Assert
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockPrisma.script.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateScript - Template Variable Validation', () => {
    it('should succeed when updating content with valid template variables', async () => {
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

      const updateData: UpdateScriptInput = {
        content: validContent
      };

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        updatedAt: new Date()
      });

      // Act
      const result = await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Assert
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockPrisma.script.update).toHaveBeenCalledTimes(1);
    });

    it('should fail when updating content with undefined variable', async () => {
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

      const updateData: UpdateScriptInput = {
        content: invalidContent
      };

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      // Act & Assert
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: password');

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.update).not.toHaveBeenCalled();
    });

    it('should rollback file rename when content validation fails with undefined variables', async () => {
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

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: invalidContent
      };

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      // Mock file exists check: source exists, target doesn't
      // First call: check if source file exists (during rename check)
      // Second call: check if target file exists for collision check
      let accessCallCount = 0;
      (mockFs.access as jest.Mock).mockImplementation((path) => {
        accessCallCount++;
        // Source file exists
        if (path.includes('test-script.yaml')) {
          return Promise.resolve();
        }
        // Target file doesn't exist (no collision)
        return Promise.reject(new Error('File not found'));
      });

      // Act & Assert
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: apiKey');

      // Verify file rename was called (original rename)
      expect(mockFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('test-script.yaml'),
        expect.stringContaining('new-script-name.yaml')
      );

      // Verify rollback was called (rename back to original)
      expect(mockFs.rename).toHaveBeenCalledTimes(2);
      expect(mockFs.rename).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('new-script-name.yaml'),
        expect.stringContaining('test-script.yaml')
      );

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.update).not.toHaveBeenCalled();
    });

    it('should skip validation when updating metadata without content', async () => {
      // Arrange
      const updateData: UpdateScriptInput = {
        description: 'Updated description',
        category: 'updated-category'
      };

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        description: 'Updated description',
        category: 'updated-category'
      });

      // Act
      const result = await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Assert
      expect(result).toBeDefined();
      expect(mockFs.writeFile).not.toHaveBeenCalled(); // No content change
      expect(mockPrisma.script.update).toHaveBeenCalledTimes(1);
    });

    it('should fail with multiple undefined variables in update', async () => {
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

      const updateData: UpdateScriptInput = {
        content: invalidContent
      };

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      // Act & Assert
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: y, z');

      // Verify no file write or DB commit occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.update).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle duplicate template variables correctly', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        content: validContent,
        format: 'yaml'
      };

      (mockPrisma.script.create as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'Test Script'
      });

      // Act
      const result = await scriptManager.createScript(createData, 'user-123');

      // Assert - should succeed
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should handle template variables with different spacing', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        content: validContent,
        format: 'yaml'
      };

      (mockPrisma.script.create as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'Test Script'
      });

      // Act
      const result = await scriptManager.createScript(createData, 'user-123');

      // Assert - should succeed (all spacing variations should be recognized)
      expect(result).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should fail when mixed valid and invalid variables', async () => {
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

      const createData: CreateScriptInput = {
        name: 'Test Script',
        content: invalidContent,
        format: 'yaml'
      };

      // Act & Assert
      await expect(
        scriptManager.createScript(createData, 'user-123')
      ).rejects.toThrow('Script uses undefined input variables: password, token');

      // Verify no persistence occurred
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockPrisma.script.create).not.toHaveBeenCalled();
    });
  });
});
