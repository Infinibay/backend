import { PrismaClient } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'
import { randomBytes } from 'crypto'
import { Connection, NwFilter } from '@infinibay/libvirt-node'

const prisma = new PrismaClient()

function generateIbayName (): string {
  return `ibay-${randomBytes(8).toString('hex')}`
}

async function createFilter (
  name: string,
  description: string,
  chain: string | null,
  type: 'generic' | 'department' | 'vm' = 'generic',
  priority: number = 500,
  stateMatch: boolean = true
): Promise<string> {
  const filter = await prisma.nWFilter.create({
    data: {
      name,
      internalName: generateIbayName(),
      uuid: uuidv4(),
      description,
      chain,
      type,
      priority,
      stateMatch
    }
  })
  return filter.id
}

async function createRule (
  filterId: string,
  action: string,
  direction: string,
  priority: number,
  protocol: string = 'all',
  options: {
    srcPort?: number;
    srcPortStart?: number;
    srcPortEnd?: number;
    dstPort?: number;
    dstPortStart?: number;
    dstPortEnd?: number;
    comment?: string;
    ipVersion?: string;
    srcIpAddr?: string;
    dstIpAddr?: string;
    state?: any;
    icmpType?: number;
    icmpCode?: number;
    macAddr?: string;
  } = {}
) {
  await prisma.fWRule.create({
    data: {
      nwFilterId: filterId,
      action,
      direction,
      priority,
      protocol,
      dstPortStart: (options.dstPort || options.dstPortStart),
      dstPortEnd: (options.dstPort || options.dstPortEnd),
      srcPortStart: (options.srcPort || options.srcPortStart),
      srcPortEnd: (options.srcPort || options.srcPortEnd),
      comment: options.comment,
      ipVersion: options.ipVersion,
      srcIpAddr: options.srcIpAddr,
      dstIpAddr: options.dstIpAddr,
      state: options.state
    }
  })
}

async function createFilterReference (sourceId: string, targetId: string) {
  await prisma.filterReference.create({
    data: {
      sourceFilterId: sourceId,
      targetFilterId: targetId
    }
  })
}

async function cleanExistingIbayFilters () {
  console.log('  Cleaning existing ibay filters...')
  let conn: Connection | null = null
  try {
    // Connect to libvirt
    conn = await Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to connect to libvirt')
    }

    // Get all network filters
    const filters = await conn.listNwFilters()
    if (!filters) {
      console.log('No network filters found')
      return
    }

    // Find and remove ibay filters
    for (const filterName of filters) {
      if (filterName.startsWith('ibay-')) {
        try {
          const filter = await NwFilter.lookupByName(conn, filterName)
          if (filter) {
            await filter.undefine()
            console.log(`Removed network filter: ${filterName}`)
          }
        } catch (error) {
          console.error(`Failed to remove filter ${filterName}:`, error)
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning existing ibay filters:', error)
    throw error
  } finally {
    if (conn) {
      await conn.close()
    }
  }
}

export async function installNetworkFilters () {
  try {
    // Clean existing filters before installing new ones
    await cleanExistingIbayFilters()

    console.log('  Installing network filters...')

    // Basic security filters
    const cleanTrafficId = await createFilter(
      'Clean Traffic',
      'Basic security measures including MAC/IP/ARP spoofing prevention',
      'root',
      'generic',
      100 // Higher priority for security filters
    )

    const noMacSpoofingId = await createFilter(
      'No MAC Spoofing',
      'Prevents MAC address spoofing',
      'mac'
    )
    await createRule(noMacSpoofingId, 'return', 'out', 500, 'all', {
      comment: 'Allow packets from VM MAC'
    })
    await createRule(noMacSpoofingId, 'drop', 'out', 500, 'all', {
      comment: 'Drop all other MAC addresses'
    })

    const noIpSpoofingId = await createFilter(
      'No IP Spoofing',
      'Prevents IP address spoofing',
      'ipv4-ip'
    )
    await createRule(noIpSpoofingId, 'return', 'out', 100, 'udp', {
      srcIpAddr: '0.0.0.0',
      comment: 'Allow DHCP requests'
    })
    await createRule(noIpSpoofingId, 'return', 'out', 500, 'all', {
      comment: 'Allow packets from VM IP'
    })
    await createRule(noIpSpoofingId, 'drop', 'out', 1000, 'all', {
      comment: 'Drop all other IPs'
    })

    // Reference basic security filters
    await createFilterReference(cleanTrafficId, noMacSpoofingId)
    await createFilterReference(cleanTrafficId, noIpSpoofingId)

    // DHCP filter
    const dhcpId = await createFilter(
      'DHCP',
      'Allows DHCP client operations',
      'ipv4'
    )
    await createRule(dhcpId, 'accept', 'out', 100, 'udp', {
      srcIpAddr: '0.0.0.0',
      dstIpAddr: '255.255.255.255',
      srcPortStart: 68,
      srcPortEnd: 68,
      dstPortStart: 67,
      dstPortEnd: 67,
      comment: 'Allow DHCP requests'
    })
    await createRule(dhcpId, 'accept', 'in', 100, 'udp', {
      srcPortStart: 67,
      srcPortEnd: 67,
      dstPortStart: 68,
      dstPortEnd: 68,
      comment: 'Allow DHCP responses'
    })

    // Service definitions with proper protocols and ports
    const services: any[] = [
      {
        name: 'SSH',
        rules: [{ protocol: 'tcp', port: 22 }]
      },
      {
        name: 'RDP',
        rules: [{ protocol: 'tcp', port: 3389 }]
      },
      {
        name: 'HTTP',
        rules: [{ protocol: 'tcp', port: 80 }]
      },
      {
        name: 'HTTPS',
        rules: [{ protocol: 'tcp', port: 443 }]
      },
      {
        name: 'DNS',
        rules: [
          { protocol: 'tcp', port: 53 },
          { protocol: 'udp', port: 53 }
        ]
      },
      {
        name: 'SMTP',
        rules: [
          { protocol: 'tcp', port: 25 },
          { protocol: 'tcp', port: 587 } // SMTP Submission
        ]
      },
      {
        name: 'SMTPS',
        rules: [{ protocol: 'tcp', port: 465 }]
      },
      {
        name: 'POP3',
        rules: [{ protocol: 'tcp', port: 110 }]
      },
      {
        name: 'POP3S',
        rules: [{ protocol: 'tcp', port: 995 }]
      },
      {
        name: 'IMAP',
        rules: [{ protocol: 'tcp', port: 143 }]
      },
      {
        name: 'IMAPS',
        rules: [{ protocol: 'tcp', port: 993 }]
      },
      {
        name: 'FTP',
        rules: [
          { protocol: 'tcp', port: 21 },
          {
            protocol: 'tcp',
            portStart: 1024,
            portEnd: 65535,
            state: { new: true, established: true, related: true }
          } // Passive mode
        ]
      },
      {
        name: 'FTPS',
        rules: [
          { protocol: 'tcp', dstPortStart: 990, dstPortEnd: 990 },
          {
            protocol: 'tcp',
            portStart: 1024,
            portEnd: 65535,
            state: { new: true, established: true, related: true }
          } // Passive mode
        ]
      },
      {
        name: 'MySQL',
        rules: [{ protocol: 'tcp', port: 3306 }]
      },
      {
        name: 'PostgreSQL',
        rules: [{ protocol: 'tcp', port: 5432 }]
      },
      {
        name: 'MongoDB',
        rules: [{ protocol: 'tcp', port: 27017 }]
      },
      {
        name: 'Redis',
        rules: [{ protocol: 'tcp', port: 6379 }]
      },
      {
        name: 'OpenVPN',
        rules: [
          { protocol: 'udp', port: 1194 },
          { protocol: 'tcp', port: 1194 }
        ]
      },
      {
        name: 'Steam',
        rules: [
          { protocol: 'tcp', port: 27015 }, // Game traffic
          { protocol: 'udp', port: 27015 }, // Game traffic
          { protocol: 'tcp', port: 27036 }, // Steam client
          { protocol: 'udp', port: 27036 }, // Steam client
          { protocol: 'tcp', port: 27037 }, // Steam downloads
          { protocol: 'tcp', port: 27031 } // Remote play
        ]
      },
      {
        name: 'cPanel',
        rules: [
          { protocol: 'tcp', port: 2082 }, // HTTP
          { protocol: 'tcp', port: 2083 } // HTTPS
        ]
      },
      {
        name: 'BitTorrent',
        rules: [
          { protocol: 'tcp', port: 6881 },
          { protocol: 'udp', port: 6881 }
        ]
      },
      {
        name: 'BackupExec',
        rules: [{ protocol: 'tcp', port: 10000 }]
      },
      {
        name: 'XDMCP',
        rules: [{ protocol: 'udp', port: 177 }]
      },
      {
        name: 'Kerberos',
        rules: [
          { protocol: 'tcp', port: 88 },
          { protocol: 'udp', port: 88 },
          { protocol: 'tcp', port: 464 },
          { protocol: 'udp', port: 464 },
          { protocol: 'tcp', port: 749 }
        ]
      },
      {
        name: 'DCOM',
        rules: [{ protocol: 'tcp', port: 135 }]
      },
      {
        name: 'MSExchange',
        rules: [
          { protocol: 'tcp', port: 135 },
          { protocol: 'udp', port: 135 },
          { protocol: 'tcp', port: 25 },
          { protocol: 'tcp', port: 587 },
          { protocol: 'tcp', port: 1024 } // Dynamic RPC ports
        ]
      },
      {
        name: 'NFS',
        rules: [
          { protocol: 'tcp', port: 2049 },
          { protocol: 'udp', port: 2049 },
          { protocol: 'tcp', port: 111 }, // Portmapper
          { protocol: 'udp', port: 111 }
        ]
      },
      {
        name: 'SMB',
        rules: [
          { protocol: 'tcp', port: 139 },
          { protocol: 'tcp', port: 445 }
        ]
      }
    ]

    for (const service of services) {
      // Create Use service filter
      const serviceFilterId = await createFilter(
        `Use ${service.name} service`,
        `Allow usage of ${service.name} service`, // Description
        null, // Chain
        'generic' // Type
      )

      for (const rule of service.rules) {
        if (rule.port != null) {
          await createRule(
            serviceFilterId,
            'accept',
            'out',
            200,
            rule.protocol,
            {
              dstPort: rule.port,
              comment: rule.comment,
              ipVersion: rule.ipVersion,
              state: rule.state,
              srcIpAddr: rule.srcIpAddr,
              dstIpAddr: rule.dstIpAddr
            }
          )
        }
      }

      // Create Provide service filter
      const provideFilterId = await createFilter(
        `Provides ${service.name} service`,
        `Allow VMs to provide ${service.name} service`, // Description
        null, // Chain
        'generic' // Type
      )

      for (const rule of service.rules) {
        if (rule.port != null) {
          await createRule(
            provideFilterId,
            'accept',
            'in',
            200,
            rule.protocol,
            {
              dstPort: rule.port,
              comment: rule.comment,
              ipVersion: rule.ipVersion,
              state: rule.state,
              srcIpAddr: rule.srcIpAddr,
              dstIpAddr: rule.dstIpAddr
            }
          )
        }
      }
    }

    // ICMP filters
    const allowPingId = await createFilter(
      'Respond to Ping requests',
      'Allows incoming ICMP echo requests (ping)',
      'ipv4'
    )
    await createRule(allowPingId, 'accept', 'in', 500, 'icmp', {
      comment: 'Allow incoming ping requests'
    })

    const usePingId = await createFilter(
      'Use Ping',
      'Allows outgoing ICMP echo requests (ping)',
      'ipv4'
    )
    await createRule(usePingId, 'accept', 'out', 500, 'icmp', {
      comment: 'Allow outgoing ping requests'
    })

    // Default reject rules
    const rejectIncomingId = await createFilter(
      'Reject Incoming',
      'Rejects all incoming connections',
      'ipv4'
    )
    await createRule(rejectIncomingId, 'reject', 'in', 1000, 'all', {
      comment: 'Reject all incoming connections'
    })

    const rejectOutgoingId = await createFilter(
      'Reject Outgoing',
      'Rejects all outgoing connections',
      'ipv4'
    )
    await createRule(rejectOutgoingId, 'reject', 'out', 1000, 'all', {
      comment: 'Reject all outgoing connections'
    })

    const dropAllId = await createFilter(
      'Drop All',
      'Rejects all incoming and outgoing connections',
      'ipv4'
    )
    await createRule(dropAllId, 'drop', 'in', 1000, 'all', {
      comment: 'Reject all incoming and outgoing connections'
    })
    await createRule(dropAllId, 'drop', 'out', 1000, 'all', {
      comment: 'Reject all incoming and outgoing connections'
    })

    // Common combinations
    const basicSecurityId = await createFilter(
      'Basic Security',
      'Basic security setup with DHCP and clean traffic',
      'root'
    )
    await createFilterReference(basicSecurityId, cleanTrafficId)
    await createFilterReference(basicSecurityId, dhcpId)
    const useHttpFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Use HTTP service' }
    })
    const useHttpsFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Use HTTPS service' }
    })
    if (useHttpFilterId) await createFilterReference(basicSecurityId, useHttpFilterId.id)
    if (useHttpsFilterId) await createFilterReference(basicSecurityId, useHttpsFilterId.id)

    const webServerSecurityId = await createFilter(
      'Web Server Security',
      'Security setup for web servers with HTTP/HTTPS access',
      'root'
    )
    await createFilterReference(webServerSecurityId, basicSecurityId)
    const httpFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Provide HTTP' }
    })
    const httpsFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Provide HTTPS' }
    })
    if (httpFilterId) await createFilterReference(webServerSecurityId, httpFilterId.id)
    if (httpsFilterId) await createFilterReference(webServerSecurityId, httpsFilterId.id)

    console.log('Network filters installed successfully!')
  } catch (error) {
    console.error('Error installing network filters:', error)
  } finally {
    await prisma.$disconnect()
  }
}
