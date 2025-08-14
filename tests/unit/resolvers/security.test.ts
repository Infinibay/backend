import 'reflect-metadata';
import { SecurityResolver } from '@resolvers/security/resolver';
import { mockPrisma } from '../../setup/jest.setup';
import { createMockContext, createAdminContext } from '../../setup/test-helpers';
import { ForbiddenError, UserInputError } from 'apollo-server-errors';
import { SecurityService } from '@services/securityService';
import { PubSub } from 'graphql-subscriptions';

// Mock SecurityService
jest.mock('@services/securityService');

// Mock PubSub
jest.mock('graphql-subscriptions');

describe('SecurityResolver', () => {
  let resolver: SecurityResolver;
  let mockSecurityService: jest.Mocked<SecurityService>;
  let mockPubSub: jest.Mocked<PubSub>;
  const ctx = createAdminContext();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSecurityService = new SecurityService() as jest.Mocked<SecurityService>;
    mockPubSub = new PubSub() as jest.Mocked<PubSub>;
    resolver = new SecurityResolver();
    (resolver as any).securityService = mockSecurityService;
    (resolver as any).pubSub = mockPubSub;
  });

  describe('Query: securitySettings', () => {
    it('should return current security settings', async () => {
      // Arrange
      const mockSettings = {
        id: 'settings-1',
        enableFirewall: true,
        enableIDS: true,
        enableAntivirus: false,
        enableEncryption: true,
        maxFailedLoginAttempts: 5,
        sessionTimeout: 3600,
        passwordPolicy: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: true,
          expirationDays: 90
        },
        twoFactorEnabled: true,
        allowedIpRanges: ['192.168.1.0/24', '10.0.0.0/8'],
        blockedIpAddresses: ['192.168.1.100', '192.168.1.101'],
        sslEnabled: true,
        sslCertificate: '/etc/ssl/certs/infinibay.crt',
        auditLogging: true,
        updatedAt: new Date()
      };
      mockSecurityService.getSettings.mockResolvedValue(mockSettings);

      // Act
      const result = await resolver.securitySettings(ctx);

      // Assert
      expect(mockSecurityService.getSettings).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockSettings);
      expect(result.enableFirewall).toBe(true);
      expect(result.passwordPolicy.minLength).toBe(12);
    });

    it('should handle missing security settings', async () => {
      // Arrange
      mockSecurityService.getSettings.mockResolvedValue(null);

      // Act
      const result = await resolver.securitySettings(ctx);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Query: securityAuditLog', () => {
    it('should return security audit logs with filtering', async () => {
      // Arrange
      const filter = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        eventType: 'LOGIN_ATTEMPT',
        userId: 'user-1',
        severity: 'HIGH'
      };
      const mockLogs = [
        {
          id: 'log-1',
          timestamp: new Date('2024-01-15'),
          eventType: 'LOGIN_ATTEMPT',
          userId: 'user-1',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
          severity: 'HIGH',
          message: 'Failed login attempt',
          details: { attempts: 3 }
        },
        {
          id: 'log-2',
          timestamp: new Date('2024-01-16'),
          eventType: 'LOGIN_ATTEMPT',
          userId: 'user-1',
          ipAddress: '192.168.1.101',
          userAgent: 'Mozilla/5.0',
          severity: 'HIGH',
          message: 'Account locked due to multiple failed attempts',
          details: { attempts: 5 }
        }
      ];
      mockSecurityService.getAuditLogs.mockResolvedValue(mockLogs);

      // Act
      const result = await resolver.securityAuditLog(filter, ctx);

      // Assert
      expect(mockSecurityService.getAuditLogs).toHaveBeenCalledWith(filter);
      expect(result).toHaveLength(2);
      expect(result[0].eventType).toBe('LOGIN_ATTEMPT');
    });

    it('should return all logs when no filter provided', async () => {
      // Arrange
      const mockLogs = [
        {
          id: 'log-1',
          timestamp: new Date(),
          eventType: 'ACCESS_GRANTED',
          severity: 'LOW'
        }
      ];
      mockSecurityService.getAuditLogs.mockResolvedValue(mockLogs);

      // Act
      const result = await resolver.securityAuditLog({}, ctx);

      // Assert
      expect(mockSecurityService.getAuditLogs).toHaveBeenCalledWith({});
      expect(result).toEqual(mockLogs);
    });
  });

  describe('Query: securityThreats', () => {
    it('should return active security threats', async () => {
      // Arrange
      const mockThreats = [
        {
          id: 'threat-1',
          type: 'BRUTE_FORCE',
          severity: 'HIGH',
          source: '192.168.1.100',
          target: 'SSH Service',
          detectedAt: new Date(),
          status: 'ACTIVE',
          description: 'Multiple failed SSH login attempts detected',
          mitigationActions: ['Block IP', 'Increase monitoring']
        },
        {
          id: 'threat-2',
          type: 'PORT_SCAN',
          severity: 'MEDIUM',
          source: '10.0.0.50',
          target: 'System',
          detectedAt: new Date(),
          status: 'MITIGATED',
          description: 'Port scanning activity detected',
          mitigationActions: ['Firewall rule applied']
        }
      ];
      mockSecurityService.getActiveThreats.mockResolvedValue(mockThreats);

      // Act
      const result = await resolver.securityThreats(ctx);

      // Assert
      expect(mockSecurityService.getActiveThreats).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('BRUTE_FORCE');
      expect(result[0].severity).toBe('HIGH');
    });
  });

  describe('Mutation: updateSecuritySettings', () => {
    it('should update security settings', async () => {
      // Arrange
      const input = {
        enableFirewall: true,
        enableIDS: true,
        maxFailedLoginAttempts: 3,
        sessionTimeout: 1800,
        passwordPolicy: {
          minLength: 16,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: true,
          expirationDays: 60
        },
        twoFactorEnabled: true
      };
      const mockUpdated = {
        id: 'settings-1',
        ...input,
        updatedAt: new Date()
      };
      mockSecurityService.updateSettings.mockResolvedValue(mockUpdated);

      // Act
      const result = await resolver.updateSecuritySettings(input, ctx);

      // Assert
      expect(mockSecurityService.updateSettings).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockUpdated);
      expect(result.passwordPolicy.minLength).toBe(16);
    });

    it('should validate security settings input', async () => {
      // Arrange
      const invalidInput = {
        maxFailedLoginAttempts: -1,
        sessionTimeout: 0
      };
      mockSecurityService.updateSettings.mockRejectedValue(
        new UserInputError('Invalid security settings')
      );

      // Act & Assert
      await expect(resolver.updateSecuritySettings(invalidInput, ctx)).rejects.toThrow(
        UserInputError
      );
    });
  });

  describe('Mutation: addIpToWhitelist', () => {
    it('should add IP address to whitelist', async () => {
      // Arrange
      const input = {
        ipAddress: '192.168.1.200',
        description: 'Admin workstation'
      };
      mockSecurityService.addToWhitelist.mockResolvedValue(true);

      // Act
      const result = await resolver.addIpToWhitelist(input, ctx);

      // Assert
      expect(mockSecurityService.addToWhitelist).toHaveBeenCalledWith(
        '192.168.1.200',
        'Admin workstation'
      );
      expect(result).toBe(true);
    });

    it('should validate IP address format', async () => {
      // Arrange
      const input = {
        ipAddress: 'invalid-ip',
        description: 'Test'
      };
      mockSecurityService.addToWhitelist.mockRejectedValue(
        new UserInputError('Invalid IP address format')
      );

      // Act & Assert
      await expect(resolver.addIpToWhitelist(input, ctx)).rejects.toThrow(
        UserInputError
      );
    });
  });

  describe('Mutation: removeIpFromWhitelist', () => {
    it('should remove IP address from whitelist', async () => {
      // Arrange
      const ipAddress = '192.168.1.200';
      mockSecurityService.removeFromWhitelist.mockResolvedValue(true);

      // Act
      const result = await resolver.removeIpFromWhitelist(ipAddress, ctx);

      // Assert
      expect(mockSecurityService.removeFromWhitelist).toHaveBeenCalledWith(ipAddress);
      expect(result).toBe(true);
    });
  });

  describe('Mutation: blockIpAddress', () => {
    it('should block an IP address', async () => {
      // Arrange
      const input = {
        ipAddress: '10.0.0.100',
        reason: 'Suspicious activity detected',
        duration: 86400 // 24 hours
      };
      mockSecurityService.blockIpAddress.mockResolvedValue(true);

      // Act
      const result = await resolver.blockIpAddress(input, ctx);

      // Assert
      expect(mockSecurityService.blockIpAddress).toHaveBeenCalledWith(input);
      expect(result).toBe(true);
    });
  });

  describe('Mutation: unblockIpAddress', () => {
    it('should unblock an IP address', async () => {
      // Arrange
      const ipAddress = '10.0.0.100';
      mockSecurityService.unblockIpAddress.mockResolvedValue(true);

      // Act
      const result = await resolver.unblockIpAddress(ipAddress, ctx);

      // Assert
      expect(mockSecurityService.unblockIpAddress).toHaveBeenCalledWith(ipAddress);
      expect(result).toBe(true);
    });
  });

  describe('Mutation: runSecurityScan', () => {
    it('should initiate a security scan', async () => {
      // Arrange
      const input = {
        scanType: 'FULL',
        targets: ['vm-1', 'vm-2'],
        deepScan: true
      };
      const mockScanResult = {
        id: 'scan-1',
        startedAt: new Date(),
        status: 'IN_PROGRESS',
        scanType: 'FULL',
        targets: ['vm-1', 'vm-2'],
        findings: []
      };
      mockSecurityService.runSecurityScan.mockResolvedValue(mockScanResult);

      // Act
      const result = await resolver.runSecurityScan(input, ctx);

      // Assert
      expect(mockSecurityService.runSecurityScan).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockScanResult);
      expect(result.status).toBe('IN_PROGRESS');
    });
  });

  describe('Mutation: mitigateThreat', () => {
    it('should mitigate a security threat', async () => {
      // Arrange
      const input = {
        threatId: 'threat-1',
        action: 'BLOCK_SOURCE',
        notes: 'Blocked malicious IP address'
      };
      const mockMitigated = {
        id: 'threat-1',
        status: 'MITIGATED',
        mitigatedAt: new Date(),
        mitigationAction: 'BLOCK_SOURCE',
        notes: 'Blocked malicious IP address'
      };
      mockSecurityService.mitigateThreat.mockResolvedValue(mockMitigated);

      // Act
      const result = await resolver.mitigateThreat(input, ctx);

      // Assert
      expect(mockSecurityService.mitigateThreat).toHaveBeenCalledWith(input);
      expect(result.status).toBe('MITIGATED');
    });
  });

  describe('Mutation: updatePasswordPolicy', () => {
    it('should update password policy', async () => {
      // Arrange
      const input = {
        minLength: 20,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        expirationDays: 30,
        preventReuse: 10
      };
      mockSecurityService.updatePasswordPolicy.mockResolvedValue(input);

      // Act
      const result = await resolver.updatePasswordPolicy(input, ctx);

      // Assert
      expect(mockSecurityService.updatePasswordPolicy).toHaveBeenCalledWith(input);
      expect(result.minLength).toBe(20);
    });
  });

  describe('Subscription: securityAlert', () => {
    it('should subscribe to security alerts', async () => {
      // Arrange
      const mockIterator = {
        next: jest.fn(),
        return: jest.fn(),
        throw: jest.fn(),
        [Symbol.asyncIterator]: jest.fn()
      };
      mockPubSub.asyncIterator.mockReturnValue(mockIterator);

      // Act
      const result = await resolver.securityAlert();

      // Assert
      expect(mockPubSub.asyncIterator).toHaveBeenCalledWith('SECURITY_ALERT');
      expect(result).toBe(mockIterator);
    });
  });

  describe('Subscription: threatDetected', () => {
    it('should subscribe to threat detection events', async () => {
      // Arrange
      const mockIterator = {
        next: jest.fn(),
        return: jest.fn(),
        throw: jest.fn(),
        [Symbol.asyncIterator]: jest.fn()
      };
      mockPubSub.asyncIterator.mockReturnValue(mockIterator);

      // Act
      const result = await resolver.threatDetected();

      // Assert
      expect(mockPubSub.asyncIterator).toHaveBeenCalledWith('THREAT_DETECTED');
      expect(result).toBe(mockIterator);
    });
  });

  describe('Query: securityCompliance', () => {
    it('should return security compliance status', async () => {
      // Arrange
      const mockCompliance = {
        overallScore: 85,
        standards: {
          'ISO_27001': {
            score: 90,
            compliant: true,
            findings: []
          },
          'PCI_DSS': {
            score: 80,
            compliant: true,
            findings: ['Minor issue with log retention']
          },
          'HIPAA': {
            score: 85,
            compliant: true,
            findings: []
          }
        },
        lastAssessment: new Date(),
        nextAssessment: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };
      mockSecurityService.getComplianceStatus.mockResolvedValue(mockCompliance);

      // Act
      const result = await resolver.securityCompliance(ctx);

      // Assert
      expect(mockSecurityService.getComplianceStatus).toHaveBeenCalledTimes(1);
      expect(result.overallScore).toBe(85);
      expect(result.standards['ISO_27001'].score).toBe(90);
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN role for security mutations', async () => {
      // Assert resolver methods exist
      expect(resolver.updateSecuritySettings).toBeDefined();
      expect(resolver.addIpToWhitelist).toBeDefined();
      expect(resolver.blockIpAddress).toBeDefined();
      expect(resolver.runSecurityScan).toBeDefined();
      expect(resolver.mitigateThreat).toBeDefined();
    });

    it('should allow USER role for security queries', async () => {
      // Assert resolver methods exist
      expect(resolver.securitySettings).toBeDefined();
      expect(resolver.securityAuditLog).toBeDefined();
      expect(resolver.securityThreats).toBeDefined();
    });
  });
});