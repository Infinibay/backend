/**
 * VirtioSocketWatcher - IP address utility functions
 *
 * Pure utility functions for IP address classification and validation.
 * Extracted from VirtioSocketWatcherService to reduce file size.
 */

/**
 * Enhanced IPv6 private address classification
 */
export function isIPv6Private(ip: string): boolean {
  // Remove any zone identifier (e.g., %eth0)
  const cleanIP = ip.split('%')[0]

  // Link-local addresses: fe80::/10
  if (cleanIP.toLowerCase().startsWith('fe8') || cleanIP.toLowerCase().startsWith('fe9') ||
    cleanIP.toLowerCase().startsWith('fea') || cleanIP.toLowerCase().startsWith('feb')) {
    return true
  }

  // Unique Local Addresses (ULA): fc00::/7 (fc00:: to fdff::)
  if (cleanIP.toLowerCase().startsWith('fc') || cleanIP.toLowerCase().startsWith('fd')) {
    return true
  }

  // Site-local addresses (deprecated but still used): fec0::/10
  if (cleanIP.toLowerCase().startsWith('fec') || cleanIP.toLowerCase().startsWith('fed') ||
    cleanIP.toLowerCase().startsWith('fee') || cleanIP.toLowerCase().startsWith('fef')) {
    return true
  }

  // Global unicast addresses (2000::/3) are considered public
  // All other IPv6 addresses are considered private by default
  return !cleanIP.toLowerCase().startsWith('2')
}

/**
 * Enhanced IPv6 validation
 */
export function isValidIPv6(ip: string): boolean {
  // Remove any zone identifier (e.g., %eth0)
  const cleanIP = ip.split('%')[0]

  // Basic IPv6 format validation
  // Must contain at least one colon
  if (!cleanIP.includes(':')) return false

  // Can't start or end with more than two colons
  if (cleanIP.startsWith(':::') || cleanIP.endsWith(':::')) return false

  // Can't have more than one double colon sequence
  const doubleColonCount = (cleanIP.match(/::/g) || []).length
  if (doubleColonCount > 1) return false

  // Split by double colon to handle compressed zeros
  const parts = cleanIP.split('::')
  if (parts.length > 2) return false

  // Validate each part
  for (const part of parts) {
    if (part === '') continue // Empty part is OK for compressed notation

    const groups = part.split(':')
    for (const group of groups) {
      if (group === '') continue // Empty group is OK

      // Each group should be 1-4 hex digits
      if (group.length > 4) return false
      if (!/^[0-9a-fA-F]+$/.test(group)) return false
    }

    // Check total number of groups doesn't exceed 8
    if (groups.length > 8) return false
  }

  return true
}

/**
 * Check if an IP address is a loopback address
 */
export function isLoopbackAddress(ip: string): boolean {
  // IPv4 loopback: 127.x.x.x
  if (ip.startsWith('127.')) return true

  // IPv6 loopback: ::1
  if (ip === '::1' || ip.toLowerCase() === '0:0:0:0:0:0:0:1') return true

  return false
}

/**
 * Check if an IPv4 address is in a private range (RFC 1918)
 */
export function isPrivateIP(ip: string): boolean {
  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true

  // 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }

  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true

  return false
}

/**
 * Get the type classification of an IP address for preference ordering
 */
export function getIPAddressType(ip: string): string {
  if (ip.includes(':')) {
    // IPv6 address
    const cleanIP = ip.split('%')[0].toLowerCase()

    // Link-local: fe80::/10
    if (cleanIP.startsWith('fe8') || cleanIP.startsWith('fe9') ||
      cleanIP.startsWith('fea') || cleanIP.startsWith('feb')) {
      return 'ipv6-link-local'
    }

    // ULA: fc00::/7
    if (cleanIP.startsWith('fc') || cleanIP.startsWith('fd')) {
      return 'ipv6-ula'
    }

    // Global unicast: 2000::/3
    if (cleanIP.startsWith('2')) {
      return 'ipv6-global'
    }

    // Other IPv6 (site-local, etc.) - treat as ULA
    return 'ipv6-ula'
  } else {
    // IPv4 address
    if (ip.startsWith('169.254.')) {
      return 'ipv4-link-local'
    }

    if (isPrivateIP(ip)) {
      return 'ipv4-private'
    }

    return 'ipv4-public'
  }
}
