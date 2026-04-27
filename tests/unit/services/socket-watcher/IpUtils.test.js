"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const IpUtils_1 = require("../../../../app/services/socket-watcher/IpUtils");
(0, globals_1.describe)('IpUtils', () => {
    (0, globals_1.describe)('isIPv6Private', () => {
        (0, globals_1.it)('should return true for link-local fe80::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fe80::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for fe9x::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fe90::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for feax::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('feab::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for feb::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('febf::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for ULA fc00::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fc00::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for ULA fd00::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fdff::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for site-local fec0::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fec0::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for fed::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fedf::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for fee::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('feee::1')).toBe(true);
        });
        (0, globals_1.it)('should return true for fef::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fef0::1')).toBe(true);
        });
        (0, globals_1.it)('should return false for global unicast 2000::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('2001:db8::1')).toBe(false);
        });
        (0, globals_1.it)('should return false for 2xxx:: addresses', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('2000::1')).toBe(false);
        });
        (0, globals_1.it)('should handle zone identifiers', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('fe80::1%eth0')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('2001:db8::1%eth0')).toBe(false);
        });
        (0, globals_1.it)('should be case insensitive', () => {
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('FE80::1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('FD00::1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isIPv6Private)('2001:DB8::1')).toBe(false);
        });
    });
    (0, globals_1.describe)('isValidIPv6', () => {
        (0, globals_1.it)('should validate standard IPv6 addresses', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('2001:db8:85a3::8a2e:370:7334')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('::1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('::')).toBe(true);
        });
        (0, globals_1.it)('should reject addresses with multiple double colons', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('2001::db8::1')).toBe(false);
        });
        (0, globals_1.it)('should reject addresses with groups longer than 4 hex digits', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('2001:0db8:85a30000:0000:0000:8a2e:0370:7334')).toBe(false);
        });
        (0, globals_1.it)('should reject addresses with invalid hex characters', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('2001:0db8:85g3:0000:0000:8a2e:0370:7334')).toBe(false);
        });
        (0, globals_1.it)('should reject addresses without colons', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('20010db885a3000000008a2e03707334')).toBe(false);
        });
        (0, globals_1.it)('should reject addresses starting or ending with :::', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)(':::1')).toBe(false);
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('1:::')).toBe(false);
        });
        (0, globals_1.it)('should handle zone identifiers', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('fe80::1%eth0')).toBe(true);
        });
        (0, globals_1.it)('should reject too many groups', () => {
            (0, globals_1.expect)((0, IpUtils_1.isValidIPv6)('1:2:3:4:5:6:7:8:9')).toBe(false);
        });
    });
    (0, globals_1.describe)('isLoopbackAddress', () => {
        (0, globals_1.it)('should detect IPv4 loopback 127.0.0.1', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('127.0.0.1')).toBe(true);
        });
        (0, globals_1.it)('should detect IPv4 loopback 127.255.255.255', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('127.255.255.255')).toBe(true);
        });
        (0, globals_1.it)('should detect IPv6 loopback ::1', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('::1')).toBe(true);
        });
        (0, globals_1.it)('should detect IPv6 loopback expanded form', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('0:0:0:0:0:0:0:1')).toBe(true);
        });
        (0, globals_1.it)('should detect IPv6 loopback uppercase', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('0:0:0:0:0:0:0:1')).toBe(true);
        });
        (0, globals_1.it)('should return false for non-loopback addresses', () => {
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('192.168.1.1')).toBe(false);
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('fe80::1')).toBe(false);
            (0, globals_1.expect)((0, IpUtils_1.isLoopbackAddress)('2001:db8::1')).toBe(false);
        });
    });
    (0, globals_1.describe)('isPrivateIP', () => {
        (0, globals_1.it)('should detect 10.0.0.0/8', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('10.0.0.1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('10.255.255.255')).toBe(true);
        });
        (0, globals_1.it)('should detect 172.16.0.0/12', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('172.16.0.1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('172.31.255.255')).toBe(true);
        });
        (0, globals_1.it)('should reject 172.15.x.x (outside /12)', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('172.15.0.1')).toBe(false);
        });
        (0, globals_1.it)('should reject 172.32.x.x (outside /12)', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('172.32.0.1')).toBe(false);
        });
        (0, globals_1.it)('should detect 192.168.0.0/16', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('192.168.0.1')).toBe(true);
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('192.168.255.255')).toBe(true);
        });
        (0, globals_1.it)('should return false for public IPs', () => {
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('8.8.8.8')).toBe(false);
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('1.1.1.1')).toBe(false);
            (0, globals_1.expect)((0, IpUtils_1.isPrivateIP)('203.0.113.1')).toBe(false);
        });
    });
    (0, globals_1.describe)('getIPAddressType', () => {
        (0, globals_1.it)('should classify IPv4 private', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('192.168.1.1')).toBe('ipv4-private');
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('10.0.0.1')).toBe('ipv4-private');
        });
        (0, globals_1.it)('should classify IPv4 public', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('8.8.8.8')).toBe('ipv4-public');
        });
        (0, globals_1.it)('should classify IPv4 link-local', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('169.254.1.1')).toBe('ipv4-link-local');
        });
        (0, globals_1.it)('should classify IPv6 link-local', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fe80::1')).toBe('ipv6-link-local');
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fe90::1')).toBe('ipv6-link-local');
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('feab::1')).toBe('ipv6-link-local');
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('febf::1')).toBe('ipv6-link-local');
        });
        (0, globals_1.it)('should classify IPv6 ULA', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fc00::1')).toBe('ipv6-ula');
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fdff::1')).toBe('ipv6-ula');
        });
        (0, globals_1.it)('should classify IPv6 global unicast', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('2001:db8::1')).toBe('ipv6-global');
        });
        (0, globals_1.it)('should treat other IPv6 as ULA', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fec0::1')).toBe('ipv6-ula');
        });
        (0, globals_1.it)('should handle zone identifiers', () => {
            (0, globals_1.expect)((0, IpUtils_1.getIPAddressType)('fe80::1%eth0')).toBe('ipv6-link-local');
        });
    });
});
