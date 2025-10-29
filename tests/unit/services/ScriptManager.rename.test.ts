// @ts-nocheck
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ScriptManager, UpdateScriptInput } from '../../../app/services/scripts/ScriptManager';
import { PrismaClient, Script, OS, ShellType, ScriptStatus } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

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

describe('ScriptManager - File Rename Operations', () => {
  let scriptManager: ScriptManager;
  let mockPrisma: any;
  let mockFs: any;

  // Test data
  const mockExistingScript: Script = {
    id: 'test-script-id',
    name: 'Old Script Name',
    fileName: 'old-script-name.yaml',
    description: 'Test script',
    category: 'test',
    tags: [],
    os: ['windows' as OS],
    shell: 'powershell' as ShellType,
    status: 'APPROVED' as ScriptStatus,
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

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fs functions with default behavior
    // By default: source file exists, target doesn't exist (no collision)
    mockFs = fs as any;
    (mockFs.access as any) = jest.fn((path) => {
      // Source file (old-script-name.yaml) exists
      if (path.includes('old-script-name')) {
        return Promise.resolve();
      }
      // Target file doesn't exist (no collision)
      return Promise.reject(new Error('File not found'));
    });
    (mockFs.rename as any) = jest.fn().mockResolvedValue(undefined);
    (mockFs.writeFile as any) = jest.fn().mockResolvedValue(undefined);
    (mockFs.readFile as any) = jest.fn().mockResolvedValue(validScriptContent);

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

  describe('updateScript - Name Change and File Rename', () => {
    it('should rename file when name changes', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'New Script Name',
        fileName: 'new-script-name.yaml'
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      const result = await scriptManager.updateScript(
        'test-script-id',
        updateData,
        'user-123'
      );

      // Verify file rename was called
      expect(mockFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('old-script-name.yaml'),
        expect.stringContaining('new-script-name.yaml')
      );

      // Verify database was updated with new fileName
      expect(mockPrisma.script.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Script Name',
            fileName: 'new-script-name.yaml'
          })
        })
      );
    });

    it('should handle collision with numeric suffix', async () => {
      // Setup - simulate collision where new-script-name.yaml exists but new-script-name-1.yaml doesn't
      (mockFs.access as jest.Mock).mockImplementation((path) => {
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

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'New Script Name',
        fileName: 'new-script-name-1.yaml'
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify mockFs.access was called to check for collisions
      expect(mockFs.access).toHaveBeenCalled();

      // Verify it renamed to the suffixed filename
      expect(mockFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('old-script-name.yaml'),
        expect.stringContaining('new-script-name-1.yaml')
      );
    });

    it('should write content to new filename after successful rename', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'New Script Name',
        fileName: 'new-script-name.yaml'
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify content was written to NEW filename, not old
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('new-script-name.yaml'),
        validScriptContent,
        'utf-8'
      );
    });

    it('should rollback file rename if database update fails', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockRejectedValue(
        new Error('Database connection lost')
      );

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Database connection lost');

      // Verify rollback was attempted
      expect(mockFs.rename).toHaveBeenCalledTimes(2);
      // First call: old -> new
      expect(mockFs.rename).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('old-script-name.yaml'),
        expect.stringContaining('new-script-name.yaml')
      );
      // Second call: new -> old (rollback)
      expect(mockFs.rename).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('new-script-name.yaml'),
        expect.stringContaining('old-script-name.yaml')
      );
    });

    it('should rollback file rename if content validation fails after rename', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      const invalidContent = 'invalid: [yaml: syntax';

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: invalidContent
      };

      // Execute
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow();

      // Verify rollback was attempted
      expect(mockFs.rename).toHaveBeenCalledTimes(2);
      // Rollback to original filename
      expect(mockFs.rename).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('new-script-name.yaml'),
        expect.stringContaining('old-script-name.yaml')
      );
    });

    it('should rollback file rename if file write fails after rename', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockFs.writeFile as jest.Mock).mockRejectedValue(
        new Error('Disk full')
      );

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Disk full');

      // Verify rollback was attempted
      expect(mockFs.rename).toHaveBeenCalledTimes(2);
    });

    it('should handle missing original file gracefully', async () => {
      // Setup - file doesn't exist
      (mockFs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'New Script Name'
        // Note: fileName should NOT be updated when file doesn't exist
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute - should not throw
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify rename was NOT called (since file didn't exist)
      expect(mockFs.rename).not.toHaveBeenCalled();

      // Verify database was updated but fileName was NOT changed
      expect(mockPrisma.script.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            fileName: expect.anything()
          })
        })
      );
    });

    it('should preserve file extension during rename', async () => {
      // Setup - test with .json extension
      const jsonScript = {
        ...mockExistingScript,
        fileName: 'old-script-name.json'
      };
      const validJsonContent = JSON.stringify({
        name: 'New Script Name',
        description: 'Test script',
        os: ['windows'],
        shell: 'powershell',
        script: 'Write-Host "Test"'
      });

      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(jsonScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...jsonScript,
        name: 'New Script Name',
        fileName: 'new-script-name.json'
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validJsonContent
      };

      // Execute
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify .json extension was preserved
      expect(mockFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.stringContaining('.json')
      );
    });

    it('should throw error for invalid name that sanitizes to empty string', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      const updateData: UpdateScriptInput = {
        name: '!!!@@@###', // Only special characters
        content: validScriptContent
      };

      // Execute & Verify
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Invalid script name');
    });

    it('should not rename file when name is unchanged', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue(mockExistingScript);

      const updateData: UpdateScriptInput = {
        name: 'Old Script Name', // Same as existing
        content: validScriptContent
      };

      // Execute
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify rename was NOT called
      expect(mockFs.rename).not.toHaveBeenCalled();
    });

    it('should include fileName in audit log when renamed', async () => {
      // Setup
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);
      (mockPrisma.script.update as jest.Mock).mockResolvedValue({
        ...mockExistingScript,
        name: 'New Script Name',
        fileName: 'new-script-name.yaml'
      });

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute
      await scriptManager.updateScript('test-script-id', updateData, 'user-123');

      // Verify audit log includes fileName change
      expect(mockPrisma.scriptAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: expect.objectContaining({
              fileName: {
                from: 'old-script-name.yaml',
                to: 'new-script-name.yaml'
              }
            })
          })
        })
      );
    });

    it('should throw error after 100 collision attempts', async () => {
      // Setup - always return true for file exists
      (mockFs.access as jest.Mock).mockResolvedValue(undefined);
      (mockPrisma.script.findUnique as jest.Mock).mockResolvedValue(mockExistingScript);

      const updateData: UpdateScriptInput = {
        name: 'New Script Name',
        content: validScriptContent
      };

      // Execute & Verify
      await expect(
        scriptManager.updateScript('test-script-id', updateData, 'user-123')
      ).rejects.toThrow('Unable to generate unique filename after 100 attempts');
    });
  });
});
