import 'reflect-metadata'
import { describe, it, expect } from '@jest/globals'
import {
  isIPv6Private,
  isValidIPv6,
  isLoopbackAddress,
  isPrivateIP,
  getIPAddressType
} from '../../../../app/services/socket-watcher/IpUtils'
describe('IpUtils', () => {
  describe('isIPv6Private', () => {
    it('should return true for link-local fe80::', () => {
      expect(isIPv6Private('fe80::1')).toBe(true)
    })

    it('should return true for fe9x::', () => {
      expect(isIPv6Private('fe90::1')).toBe(true)
    })

    it('should return true for feax::', () => {
      expect(isIPv6Private('feab::1')).toBe(true)
    })

    it('should return true for feb::', () => {
      expect(isIPv6Private('febf::1')).toBe(true)
    })

    it('should return true for ULA fc00::', () => {
      expect(isIPv6Private('fc00::1')).toBe(true)
    })

    it('should return true for ULA fd00::', () => {
      expect(isIPv6Private('fdff::1')).toBe(true)
    })

    it('should return true for site-local fec0::', () => {
      expect(isIPv6Private('fec0::1')).toBe(true)
    })

    it('should return true for fed::', () => {
      expect(isIPv6Private('fedf::1')).toBe(true)
    })

    it('should return true for fee::', () => {
      expect(isIPv6Private('feee::1')).toBe(true)
    })

    it('should return true for fef::', () => {
      expect(isIPv6Private('fef0::1')).toBe(true)
    })

    it('should return false for global unicast 2000::', () => {
      expect(isIPv6Private('2001:db8::1')).toBe(false)
    })

    it('should return false for 2xxx:: addresses', () => {
      expect(isIPv6Private('2000::1')).toBe(false)
    })

    it('should handle zone identifiers', () => {
      expect(isIPv6Private('fe80::1%eth0')).toBe(true)
      expect(isIPv6Private('2001:db8::1%eth0')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(isIPv6Private('FE80::1')).toBe(true)
      expect(isIPv6Private('FD00::1')).toBe(true)
      expect(isIPv6Private('2001:DB8::1')).toBe(false)
    })
  })

  describe('isValidIPv6', () => {
    it('should validate standard IPv6 addresses', () => {
      expect(isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
      expect(isValidIPv6('2001:db8:85a3::8a2e:370:7334')).toBe(true)
      expect(isValidIPv6('::1')).toBe(true)
      expect(isValidIPv6('::')).toBe(true)
    })

    it('should reject addresses with multiple double colons', () => {
      expect(isValidIPv6('2001::db8::1')).toBe(false)
    })

    it('should reject addresses with groups longer than 4 hex digits', () => {
      expect(isValidIPv6('2001:0db8:85a30000:0000:0000:8a2e:0370:7334')).toBe(false)
    })

    it('should reject addresses with invalid hex characters', () => {
      expect(isValidIPv6('2001:0db8:85g3:0000:0000:8a2e:0370:7334')).toBe(false)
    })

    it('should reject addresses without colons', () => {
      expect(isValidIPv6('20010db885a3000000008a2e03707334')).toBe(false)
    })

    it('should reject addresses starting or ending with :::', () => {
      expect(isValidIPv6(':::1')).toBe(false)
      expect(isValidIPv6('1:::')).toBe(false)
    })

    it('should handle zone identifiers', () => {
      expect(isValidIPv6('fe80::1%eth0')).toBe(true)
    })

    it('should reject too many groups', () => {
      expect(isValidIPv6('1:2:3:4:5:6:7:8:9')).toBe(false)
    })
  })

  describe('isLoopbackAddress', () => {
    it('should detect IPv4 loopback 127.0.0.1', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    })

    it('should detect IPv4 loopback 127.255.255.255', () => {
      expect(isLoopbackAddress('127.255.255.255')).toBe(true)
    })

    it('should detect IPv6 loopback ::1', () => {
      expect(isLoopbackAddress('::1')).toBe(true)
    })

    it('should detect IPv6 loopback expanded form', () => {
      expect(isLoopbackAddress('0:0:0:0:0:0:0:1')).toBe(true)
    })

    it('should detect IPv6 loopback uppercase', () => {
      expect(isLoopbackAddress('0:0:0:0:0:0:0:1')).toBe(true)
    })

    it('should return false for non-loopback addresses', () => {
      expect(isLoopbackAddress('192.168.1.1')).toBe(false)
      expect(isLoopbackAddress('fe80::1')).toBe(false)
      expect(isLoopbackAddress('2001:db8::1')).toBe(false)
    })
  })

  describe('isPrivateIP', () => {
    it('should detect 10.0.0.0/8', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true)
      expect(isPrivateIP('10.255.255.255')).toBe(true)
    })

    it('should detect 172.16.0.0/12', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true)
      expect(isPrivateIP('172.31.255.255')).toBe(true)
    })

    it('should reject 172.15.x.x (outside /12)', () => {
      expect(isPrivateIP('172.15.0.1')).toBe(false)
    })

    it('should reject 172.32.x.x (outside /12)', () => {
      expect(isPrivateIP('172.32.0.1')).toBe(false)
    })

    it('should detect 192.168.0.0/16', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true)
      expect(isPrivateIP('192.168.255.255')).toBe(true)
    })

    it('should return false for public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false)
      expect(isPrivateIP('1.1.1.1')).toBe(false)
      expect(isPrivateIP('203.0.113.1')).toBe(false)
    })
  })

  describe('getIPAddressType', () => {
    it('should classify IPv4 private', () => {
      expect(getIPAddressType('192.168.1.1')).toBe('ipv4-private')
      expect(getIPAddressType('10.0.0.1')).toBe('ipv4-private')
    })

    it('should classify IPv4 public', () => {
      expect(getIPAddressType('8.8.8.8')).toBe('ipv4-public')
    })

    it('should classify IPv4 link-local', () => {
      expect(getIPAddressType('169.254.1.1')).toBe('ipv4-link-local')
    })

    it('should classify IPv6 link-local', () => {
      expect(getIPAddressType('fe80::1')).toBe('ipv6-link-local')
      expect(getIPAddressType('fe90::1')).toBe('ipv6-link-local')
      expect(getIPAddressType('feab::1')).toBe('ipv6-link-local')
      expect(getIPAddressType('febf::1')).toBe('ipv6-link-local')
    })

    it('should classify IPv6 ULA', () => {
      expect(getIPAddressType('fc00::1')).toBe('ipv6-ula')
      expect(getIPAddressType('fdff::1')).toBe('ipv6-ula')
    })

    it('should classify IPv6 global unicast', () => {
      expect(getIPAddressType('2001:db8::1')).toBe('ipv6-global')
    })

    it('should treat other IPv6 as ULA', () => {
      expect(getIPAddressType('fec0::1')).toBe('ipv6-ula')
    })

    it('should handle zone identifiers', () => {
      expect(getIPAddressType('fe80::1%eth0')).toBe('ipv6-link-local')
    })
  })
})