import 'reflect-metadata'
import { describe, it, expect, beforeEach } from '@jest/globals'
import { PortValidationService } from '../../../app/services/PortValidationService'
import { AppError, ErrorCode } from '../../../app/utils/errors/ErrorHandler'
import type { PortRange, ValidationResult, ConflictDetection, CommonPort } from '../../../app/services/PortValidationService'

describe('PortValidationService', () => {
  let service: PortValidationService

  beforeEach(() => {
    service = new PortValidationService()
  })

  describe('validatePortString', () => {
    describe('Valid cases', () => {
      it('should validate individual ports', () => {
        const testCases = ['80', '443', '22', '3000', '8080']

        testCases.forEach(port => {
          const result = service.validatePortString(port)
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)
        })
      })

      it('should validate port ranges', () => {
        const testCases = ['80-90', '1024-65535', '3000-3100', '8080-8090']

        testCases.forEach(range => {
          const result = service.validatePortString(range)
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)
        })
      })

      it('should validate multiple ports', () => {
        const testCases = ['80,443', '22,80,443', '3000,8080,9000']

        testCases.forEach(ports => {
          const result = service.validatePortString(ports)
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)
        })
      })

      it('should validate combinations of ports and ranges', () => {
        const testCases = [
          '80,443,8080-8090',
          '22,80-90,443,3000-3100',
          '80,443,8080-8090,9000'
        ]

        testCases.forEach(combination => {
          const result = service.validatePortString(combination)
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)
        })
      })

      it('should validate special value "all"', () => {
        const result = service.validatePortString('all')
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
        expect(result.warnings).toContain('Using "all" opens all ports - ensure this is intended')
      })

      it('should handle whitespace properly', () => {
        const testCases = [
          ' 80 ',
          ' 80,443 ',
          ' 80-90 ',
          ' 80, 443, 8080 ',
          ' 80-90, 443 '
        ]

        testCases.forEach(ports => {
          const result = service.validatePortString(ports)
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)
        })
      })
    })

    describe('Invalid cases', () => {
      it('should reject null and undefined inputs', () => {
        const testCases = [null, undefined, '']

        testCases.forEach(input => {
          const result = service.validatePortString(input as any)
          expect(result.isValid).toBe(false)
          expect(result.errors.length).toBeGreaterThan(0)
        })
      })

      it('should reject empty strings', () => {
        const testCases = ['', '   ', '\t', '\n']

        testCases.forEach(input => {
          const result = service.validatePortString(input)
          expect(result.isValid).toBe(false)
          expect(result.errors).toContain('Port string cannot be empty')
        })
      })

      it('should reject invalid port formats', () => {
        const testCases = [
          { input: 'abc', error: 'Invalid port: "abc"' },
          { input: '80-', error: 'Invalid range format: "80-". Both start and end ports are required' },
          { input: '-90', error: 'Invalid port: "-90"' },
          { input: '80--90', error: 'Invalid range format: "80--90". Use format "start-end"' },
          { input: '80-90-100', error: 'Invalid range format: "80-90-100". Use format "start-end"' }
        ]

        testCases.forEach(({ input, error }) => {
          const result = service.validatePortString(input)
          expect(result.isValid).toBe(false)
          expect(result.errors).toContain(error)
        })
      })

      it('should reject out of range ports', () => {
        const testCases = [
          { input: '0', error: 'Invalid port: "0"' },
          { input: '65536', error: 'Invalid port: "65536"' },
          { input: '70000', error: 'Invalid port: "70000"' },
          { input: '-1', error: 'Invalid port: "-1"' }
        ]

        testCases.forEach(({ input, error }) => {
          const result = service.validatePortString(input)
          expect(result.isValid).toBe(false)
          expect(result.errors).toContain(error)
        })
      })

      it('should reject invalid ranges', () => {
        const testCases = [
          { input: '90-80', error: 'Invalid range: start port 90 is greater than end port 80' },
          { input: '100-50', error: 'Invalid range: start port 100 is greater than end port 50' },
          { input: '443-22', error: 'Invalid range: start port 443 is greater than end port 22' }
        ]

        testCases.forEach(({ input, error }) => {
          const result = service.validatePortString(input)
          expect(result.isValid).toBe(false)
          expect(result.errors).toContain(error)
        })
      })

      it('should reject ranges with invalid ports', () => {
        const testCases = [
          '0-80',
          '80-65536',
          'abc-80',
          '80-xyz',
          '80-',
          '-80'
        ]

        testCases.forEach(input => {
          const result = service.validatePortString(input)
          expect(result.isValid).toBe(false)
          expect(result.errors.length).toBeGreaterThan(0)
        })
      })

      it('should handle mixed valid and invalid parts', () => {
        const result = service.validatePortString('80,invalid,443')
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Invalid port: "invalid"')
      })
    })

    describe('Warnings', () => {
      it('should warn about well-known ports', () => {
        const testCases = ['22', '80', '443', '1023']

        testCases.forEach(port => {
          const result = service.validatePortString(port)
          expect(result.isValid).toBe(true)
          expect(result.warnings).toContain(`Port ${port} is in the well-known ports range (1-1023)`)
        })
      })

      it('should warn about large port ranges', () => {
        const result = service.validatePortString('1000-5000')
        expect(result.isValid).toBe(true)
        expect(result.warnings).toContain('Large port range (1000-5000) may impact performance')
      })

      it('should not warn about small ranges', () => {
        const result = service.validatePortString('8080-8090')
        expect(result.isValid).toBe(true)
        expect(result.warnings).toBeUndefined()
      })
    })
  })

  describe('parsePortString', () => {
    it('should parse individual ports', () => {
      const result = service.parsePortString('80')
      expect(result).toEqual([{ start: 80, end: 80 }])
    })

    it('should parse port ranges', () => {
      const result = service.parsePortString('80-90')
      expect(result).toEqual([{ start: 80, end: 90 }])
    })

    it('should parse multiple ports', () => {
      const result = service.parsePortString('80,443,3000')
      expect(result).toEqual([
        { start: 80, end: 80 },
        { start: 443, end: 443 },
        { start: 3000, end: 3000 }
      ])
    })

    it('should parse combinations', () => {
      const result = service.parsePortString('80,443,8080-8090')
      expect(result).toEqual([
        { start: 80, end: 80 },
        { start: 443, end: 443 },
        { start: 8080, end: 8090 }
      ])
    })

    it('should parse "all" as full range', () => {
      const result = service.parsePortString('all')
      expect(result).toEqual([{ start: 1, end: 65535 }])
    })

    it('should handle whitespace', () => {
      const result = service.parsePortString(' 80, 443 , 8080-8090 ')
      expect(result).toEqual([
        { start: 80, end: 80 },
        { start: 443, end: 443 },
        { start: 8080, end: 8090 }
      ])
    })

    it('should throw AppError for invalid input', () => {
      expect(() => service.parsePortString('invalid'))
        .toThrow(AppError)

      try {
        service.parsePortString('invalid')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCode.VALIDATION_ERROR)
        expect((error as AppError).statusCode).toBe(400)
      }
    })
  })

  describe('detectPortConflicts', () => {
    it('should detect no conflicts when ranges don\'t overlap', () => {
      const existing: PortRange[] = [
        { start: 80, end: 80 },
        { start: 443, end: 443 }
      ]
      const newRanges: PortRange[] = [
        { start: 3000, end: 3000 },
        { start: 8080, end: 8090 }
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(false)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should detect overlapping ranges', () => {
      const existing: PortRange[] = [
        { start: 80, end: 90 }
      ]
      const newRanges: PortRange[] = [
        { start: 85, end: 95 }
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].description).toBe(
        'Port range 85-95 overlaps with existing range 80-90'
      )
    })

    it('should detect exact matches', () => {
      const existing: PortRange[] = [
        { start: 80, end: 80 }
      ]
      const newRanges: PortRange[] = [
        { start: 80, end: 80 }
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
    })

    it('should detect contained ranges', () => {
      const existing: PortRange[] = [
        { start: 80, end: 100 }
      ]
      const newRanges: PortRange[] = [
        { start: 85, end: 95 }
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
    })

    it('should detect multiple conflicts', () => {
      const existing: PortRange[] = [
        { start: 80, end: 90 },
        { start: 443, end: 443 }
      ]
      const newRanges: PortRange[] = [
        { start: 85, end: 95 },
        { start: 443, end: 443 }
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(2)
    })

    it('should handle edge cases', () => {
      const existing: PortRange[] = [
        { start: 80, end: 90 }
      ]
      const newRanges: PortRange[] = [
        { start: 90, end: 100 }, // Adjacent touching
        { start: 70, end: 80 }   // Adjacent touching
      ]

      const result = service.detectPortConflicts(existing, newRanges)
      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(2)
    })
  })

  describe('optimizePortRanges', () => {
    it('should return empty array for empty input', () => {
      const result = service.optimizePortRanges([])
      expect(result).toEqual([])
    })

    it('should return single range unchanged', () => {
      const input: PortRange[] = [{ start: 80, end: 90 }]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual(input)
    })

    it('should merge overlapping ranges', () => {
      const input: PortRange[] = [
        { start: 80, end: 90 },
        { start: 85, end: 100 }
      ]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual([{ start: 80, end: 100 }])
    })

    it('should merge adjacent ranges', () => {
      const input: PortRange[] = [
        { start: 80, end: 90 },
        { start: 91, end: 100 }
      ]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual([{ start: 80, end: 100 }])
    })

    it('should merge multiple overlapping ranges', () => {
      const input: PortRange[] = [
        { start: 80, end: 90 },
        { start: 85, end: 95 },
        { start: 92, end: 100 },
        { start: 200, end: 210 }
      ]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual([
        { start: 80, end: 100 },
        { start: 200, end: 210 }
      ])
    })

    it('should handle unsorted input', () => {
      const input: PortRange[] = [
        { start: 200, end: 210 },
        { start: 80, end: 90 },
        { start: 85, end: 95 }
      ]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual([
        { start: 80, end: 95 },
        { start: 200, end: 210 }
      ])
    })

    it('should handle single ports', () => {
      const input: PortRange[] = [
        { start: 80, end: 80 },
        { start: 81, end: 81 },
        { start: 443, end: 443 }
      ]
      const result = service.optimizePortRanges(input)
      expect(result).toEqual([
        { start: 80, end: 81 },
        { start: 443, end: 443 }
      ])
    })

    it('should not modify original array', () => {
      const input: PortRange[] = [
        { start: 80, end: 90 },
        { start: 85, end: 95 }
      ]
      const originalInput = JSON.parse(JSON.stringify(input))

      service.optimizePortRanges(input)
      expect(input).toEqual(originalInput)
    })
  })

  describe('getCommonPorts', () => {
    it('should return TCP ports when protocol is tcp', () => {
      const result = service.getCommonPorts('tcp')
      expect(result.length).toBeGreaterThan(0)
      expect(result.every(port => port.protocol === 'tcp')).toBe(true)
      expect(result.some(port => port.port === 22 && port.name === 'SSH')).toBe(true)
      expect(result.some(port => port.port === 80 && port.name === 'HTTP')).toBe(true)
      expect(result.some(port => port.port === 443 && port.name === 'HTTPS')).toBe(true)
    })

    it('should return UDP ports when protocol is udp', () => {
      const result = service.getCommonPorts('udp')
      expect(result.length).toBeGreaterThan(0)
      expect(result.every(port => port.protocol === 'udp')).toBe(true)
      expect(result.some(port => port.port === 53 && port.name === 'DNS')).toBe(true)
    })

    it('should return all ports when protocol is all', () => {
      const result = service.getCommonPorts('all')
      expect(result.length).toBeGreaterThan(0)
      expect(result.some(port => port.protocol === 'tcp')).toBe(true)
      expect(result.some(port => port.protocol === 'udp')).toBe(true)
    })

    it('should return all ports when no protocol specified', () => {
      const result = service.getCommonPorts()
      expect(result.length).toBeGreaterThan(0)
      expect(result.some(port => port.protocol === 'tcp')).toBe(true)
      expect(result.some(port => port.protocol === 'udp')).toBe(true)
    })

    it('should return empty array for invalid protocol', () => {
      const result = service.getCommonPorts('invalid' as any)
      expect(result).toEqual([])
    })

    it('should return ports with correct structure', () => {
      const result = service.getCommonPorts('tcp')
      expect(result.length).toBeGreaterThan(0)

      result.forEach(port => {
        expect(port).toHaveProperty('port')
        expect(port).toHaveProperty('name')
        expect(port).toHaveProperty('description')
        expect(port).toHaveProperty('protocol')
        expect(typeof port.port).toBe('number')
        expect(typeof port.name).toBe('string')
        expect(typeof port.description).toBe('string')
        expect(['tcp', 'udp', 'both']).toContain(port.protocol)
      })
    })
  })

  describe('formatPortRange', () => {
    it('should format single ports', () => {
      const result = service.formatPortRange({ start: 80, end: 80 })
      expect(result).toBe('80')
    })

    it('should format port ranges', () => {
      const result = service.formatPortRange({ start: 80, end: 90 })
      expect(result).toBe('80-90')
    })

    it('should format full range as "all"', () => {
      const result = service.formatPortRange({ start: 1, end: 65535 })
      expect(result).toBe('all')
    })

    it('should format large ranges normally', () => {
      const result = service.formatPortRange({ start: 1000, end: 65535 })
      expect(result).toBe('1000-65535')
    })
  })

  describe('formatPortRanges', () => {
    it('should format multiple ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 80 },
        { start: 443, end: 443 },
        { start: 8080, end: 8090 }
      ]
      const result = service.formatPortRanges(ranges)
      expect(result).toBe('80,443,8080-8090')
    })

    it('should handle empty array', () => {
      const result = service.formatPortRanges([])
      expect(result).toBe('')
    })

    it('should handle single range', () => {
      const result = service.formatPortRanges([{ start: 80, end: 90 }])
      expect(result).toBe('80-90')
    })

    it('should handle "all" range in combination', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 80 },
        { start: 1, end: 65535 }
      ]
      const result = service.formatPortRanges(ranges)
      expect(result).toBe('80,all')
    })
  })

  describe('validatePortStringWithConflicts', () => {
    it('should pass validation when no conflicts', () => {
      const existing: PortRange[] = [
        { start: 80, end: 80 },
        { start: 443, end: 443 }
      ]

      const result = service.validatePortStringWithConflicts('3000,8080-8090', existing)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation when conflicts exist', () => {
      const existing: PortRange[] = [
        { start: 80, end: 90 }
      ]

      const result = service.validatePortStringWithConflicts('85-95', existing)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Port range 85-95 overlaps with existing range 80-90')
    })

    it('should fail validation for invalid port string', () => {
      const existing: PortRange[] = []

      const result = service.validatePortStringWithConflicts('invalid', existing)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Invalid port: "invalid"')
    })

    it('should preserve warnings from base validation', () => {
      const existing: PortRange[] = []

      const result = service.validatePortStringWithConflicts('22', existing)
      expect(result.isValid).toBe(true)
      expect(result.warnings).toContain('Port 22 is in the well-known ports range (1-1023)')
    })

    it('should handle multiple conflicts', () => {
      const existing: PortRange[] = [
        { start: 80, end: 90 },
        { start: 443, end: 443 }
      ]

      const result = service.validatePortStringWithConflicts('85-95,443', existing)
      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(2)
      expect(result.errors).toContain('Port range 85-95 overlaps with existing range 80-90')
      expect(result.errors).toContain('Port range 443-443 overlaps with existing range 443-443')
    })
  })
})