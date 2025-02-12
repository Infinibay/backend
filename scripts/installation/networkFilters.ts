import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function generateIbayName(): string {
  return `ibay-${randomBytes(8).toString('hex')}`;
}

async function createFilter(
  name: string,
  description: string,
  chain: string | null,
  type: 'generic' | 'department' | 'vm' = 'generic'
): Promise<string> {
  const filter = await prisma.nWFilter.create({
    data: {
      name,
      internalName: generateIbayName(),
      uuid: uuidv4(),
      description,
      chain,
      type,
    },
  });
  return filter.id;
}

async function createRule(
  filterId: string,
  action: string,
  direction: string,
  priority: number,
  protocol: string = 'all',
  port?: number,
  options: {
    srcPortStart?: number;
    srcPortEnd?: number;
    dstPortStart?: number;
    dstPortEnd?: number;
    comment?: string;
    ipVersion?: string;
    srcIpAddr?: string;
    dstIpAddr?: string;
    state?: any;
  } = {}
) {
  await prisma.fWRule.create({
    data: {
      nwFilterId: filterId,
      action,
      direction,
      priority,
      protocol,
      dstPortStart: port,
      dstPortEnd: port,
      srcPortStart: options.srcPortStart,
      srcPortEnd: options.srcPortEnd,
      comment: options.comment,
      ipVersion: options.ipVersion,
      srcIpAddr: options.srcIpAddr,
      dstIpAddr: options.dstIpAddr,
      state: options.state,
    },
  });
}

async function createFilterReference(sourceId: string, targetId: string) {
  await prisma.filterReference.create({
    data: {
      sourceFilterId: sourceId,
      targetFilterId: targetId,
    },
  });
}

export async function installNetworkFilters() {
  try {
    // Basic security filters
    const cleanTrafficId = await createFilter(
      'Clean Traffic',
      'Basic security measures including MAC/IP/ARP spoofing prevention',
      'root'
    );

    const noMacSpoofingId = await createFilter(
      'No MAC Spoofing',
      'Prevents MAC address spoofing',
      'mac'
    );
    await createRule(noMacSpoofingId, 'return', 'out', 500, 'all', undefined, {
      comment: 'Allow packets from VM MAC',
    });
    await createRule(noMacSpoofingId, 'drop', 'out', 500, 'all', undefined, {
      comment: 'Drop all other MAC addresses',
    });

    const noIpSpoofingId = await createFilter(
      'No IP Spoofing',
      'Prevents IP address spoofing',
      'ipv4-ip'
    );
    await createRule(noIpSpoofingId, 'return', 'out', 100, 'udp', undefined, {
      srcIpAddr: '0.0.0.0',
      comment: 'Allow DHCP requests',
    });
    await createRule(noIpSpoofingId, 'return', 'out', 500, 'all', undefined, {
      comment: 'Allow packets from VM IP',
    });
    await createRule(noIpSpoofingId, 'drop', 'out', 1000, 'all', undefined, {
      comment: 'Drop all other IPs',
    });

    // Reference basic security filters
    await createFilterReference(cleanTrafficId, noMacSpoofingId);
    await createFilterReference(cleanTrafficId, noIpSpoofingId);

    // DHCP filter
    const dhcpId = await createFilter(
      'DHCP',
      'Allows DHCP client operations',
      'ipv4'
    );
    await createRule(dhcpId, 'accept', 'out', 100, 'udp', undefined, {
      srcIpAddr: '0.0.0.0',
      dstIpAddr: '255.255.255.255',
      srcPortStart: 68,
      srcPortEnd: 68,
      dstPortStart: 67,
      dstPortEnd: 67,
      comment: 'Allow DHCP requests',
    });
    await createRule(dhcpId, 'accept', 'in', 100, 'udp', undefined, {
      srcPortStart: 67,
      srcPortEnd: 67,
      dstPortStart: 68,
      dstPortEnd: 68,
      comment: 'Allow DHCP responses',
    });

    // Service definitions with proper protocols and ports
    const services = [
      {
        name: 'SSH',
        rules: [{ protocol: 'tcp', dstPortStart: 22, dstPortEnd: 22 }],
      },
      {
        name: 'RDP',
        rules: [{ protocol: 'tcp', dstPortStart: 3389, dstPortEnd: 3389 }],
      },
      {
        name: 'HTTP',
        rules: [{ protocol: 'tcp', dstPortStart: 80, dstPortEnd: 80 }],
      },
      {
        name: 'HTTPS',
        rules: [{ protocol: 'tcp', dstPortStart: 443, dstPortEnd: 443 }],
      },
      {
        name: 'DNS',
        rules: [
          { protocol: 'tcp', dstPortStart: 53, dstPortEnd: 53 },
          { protocol: 'udp', dstPortStart: 53, dstPortEnd: 53 },
        ],
      },
      {
        name: 'SMTP',
        rules: [
          { protocol: 'tcp', dstPortStart: 25, dstPortEnd: 25 },
          { protocol: 'tcp', dstPortStart: 587, dstPortEnd: 587 }, // SMTP Submission
        ],
      },
      {
        name: 'SMTPS',
        rules: [{ protocol: 'tcp', dstPortStart: 465, dstPortEnd: 465 }],
      },
      {
        name: 'POP3',
        rules: [{ protocol: 'tcp', dstPortStart: 110, dstPortEnd: 110 }],
      },
      {
        name: 'POP3S',
        rules: [{ protocol: 'tcp', dstPortStart: 995, dstPortEnd: 995 }],
      },
      {
        name: 'IMAP',
        rules: [{ protocol: 'tcp', dstPortStart: 143, dstPortEnd: 143 }],
      },
      {
        name: 'IMAPS',
        rules: [{ protocol: 'tcp', dstPortStart: 993, dstPortEnd: 993 }],
      },
      {
        name: 'FTP',
        rules: [
          { protocol: 'tcp', dstPortStart: 21, dstPortEnd: 21 },
          {
            protocol: 'tcp',
            dstPortStart: 1024,
            dstPortEnd: 65535,
            state: { new: true, established: true, related: true },
          }, // Passive mode
        ],
      },
      {
        name: 'FTPS',
        rules: [
          { protocol: 'tcp', dstPortStart: 990, dstPortEnd: 990 },
          {
            protocol: 'tcp',
            dstPortStart: 1024,
            dstPortEnd: 65535,
            state: { new: true, established: true, related: true },
          }, // Passive mode
        ],
      },
      {
        name: 'MySQL',
        rules: [{ protocol: 'tcp', dstPortStart: 3306, dstPortEnd: 3306 }],
      },
      {
        name: 'PostgreSQL',
        rules: [{ protocol: 'tcp', dstPortStart: 5432, dstPortEnd: 5432 }],
      },
      {
        name: 'MongoDB',
        rules: [{ protocol: 'tcp', dstPortStart: 27017, dstPortEnd: 27017 }],
      },
      {
        name: 'Redis',
        rules: [{ protocol: 'tcp', dstPortStart: 6379, dstPortEnd: 6379 }],
      },
      {
        name: 'OpenVPN',
        rules: [
          { protocol: 'udp', dstPortStart: 1194, dstPortEnd: 1194 },
          { protocol: 'tcp', dstPortStart: 1194, dstPortEnd: 1194 },
        ],
      },
      {
        name: 'Steam',
        rules: [
          { protocol: 'tcp', dstPortStart: 27015, dstPortEnd: 27015 }, // Game traffic
          { protocol: 'udp', dstPortStart: 27015, dstPortEnd: 27015 }, // Game traffic
          { protocol: 'tcp', dstPortStart: 27036, dstPortEnd: 27036 }, // Steam client
          { protocol: 'udp', dstPortStart: 27036, dstPortEnd: 27036 }, // Steam client
          { protocol: 'tcp', dstPortStart: 27037, dstPortEnd: 27037 }, // Steam downloads
          { protocol: 'tcp', dstPortStart: 27031, dstPortEnd: 27036 }, // Remote play
        ],
      },
      {
        name: 'cPanel',
        rules: [
          { protocol: 'tcp', dstPortStart: 2082, dstPortEnd: 2082 }, // HTTP
          { protocol: 'tcp', dstPortStart: 2083, dstPortEnd: 2083 }, // HTTPS
        ],
      },
      {
        name: 'BitTorrent',
        rules: [
          { protocol: 'tcp', dstPortStart: 6881, dstPortEnd: 6999 },
          { protocol: 'udp', dstPortStart: 6881, dstPortEnd: 6999 },
        ],
      },
      {
        name: 'BackupExec',
        rules: [{ protocol: 'tcp', dstPortStart: 10000, dstPortEnd: 10000 }],
      },
      {
        name: 'XDMCP',
        rules: [{ protocol: 'udp', dstPortStart: 177, dstPortEnd: 177 }],
      },
      {
        name: 'Kerberos',
        rules: [
          { protocol: 'tcp', dstPortStart: 88, dstPortEnd: 88 },
          { protocol: 'udp', dstPortStart: 88, dstPortEnd: 88 },
          { protocol: 'tcp', dstPortStart: 464, dstPortEnd: 464 },
          { protocol: 'udp', dstPortStart: 464, dstPortEnd: 464 },
          { protocol: 'tcp', dstPortStart: 749, dstPortEnd: 749 },
        ],
      },
      {
        name: 'DCOM',
        rules: [{ protocol: 'tcp', dstPortStart: 135, dstPortEnd: 135 }],
      },
      {
        name: 'MSExchange',
        rules: [
          { protocol: 'tcp', dstPortStart: 135, dstPortEnd: 135 },
          { protocol: 'udp', dstPortStart: 135, dstPortEnd: 135 },
          { protocol: 'tcp', dstPortStart: 25, dstPortEnd: 25 },
          { protocol: 'tcp', dstPortStart: 587, dstPortEnd: 587 },
          { protocol: 'tcp', dstPortStart: 1024, dstPortEnd: 65535 }, // Dynamic RPC ports
        ],
      },
      {
        name: 'NFS',
        rules: [
          { protocol: 'tcp', dstPortStart: 2049, dstPortEnd: 2049 },
          { protocol: 'udp', dstPortStart: 2049, dstPortEnd: 2049 },
          { protocol: 'tcp', dstPortStart: 111, dstPortEnd: 111 }, // Portmapper
          { protocol: 'udp', dstPortStart: 111, dstPortEnd: 111 },
        ],
      },
      {
        name: 'SMB',
        rules: [
          { protocol: 'tcp', dstPortStart: 139, dstPortEnd: 139 },
          { protocol: 'tcp', dstPortStart: 445, dstPortEnd: 445 },
        ],
      },
    ];

    for (const service of services) {
      const serviceFilterId = await createFilter(
        service.name,
        `Allow ${service.name} traffic`, // Description
        null, // Chain
        'generic' // Type
      );

      for (const rule of service.rules) {
        await createRule(
          serviceFilterId,
          'accept',
          'in',
          200,
          rule.protocol,
          undefined,
          rule
        );
      }
    }

    // ICMP filters
    const allowPingId = await createFilter(
      'Allow Ping',
      'Allows incoming ICMP echo requests (ping)',
      'ipv4'
    );
    await createRule(allowPingId, 'accept', 'in', 500, 'icmp', undefined, {
      comment: 'Allow incoming ping requests',
    });

    const usePingId = await createFilter(
      'Use Ping',
      'Allows outgoing ICMP echo requests (ping)',
      'ipv4'
    );
    await createRule(usePingId, 'accept', 'out', 500, 'icmp', undefined, {
      comment: 'Allow outgoing ping requests',
    });

    // Default reject rules
    const rejectIncomingId = await createFilter(
      'Reject Incoming',
      'Rejects all incoming connections',
      'ipv4'
    );
    await createRule(rejectIncomingId, 'reject', 'in', 1000, 'all', undefined, {
      comment: 'Reject all incoming connections',
    });

    const rejectOutgoingId = await createFilter(
      'Reject Outgoing',
      'Rejects all outgoing connections',
      'ipv4'
    );
    await createRule(rejectOutgoingId, 'reject', 'out', 1000, 'all', undefined, {
      comment: 'Reject all outgoing connections',
    });

    // Common combinations
    const basicSecurityId = await createFilter(
      'Basic Security',
      'Basic security setup with DHCP and clean traffic',
      'root'
    );
    await createFilterReference(basicSecurityId, cleanTrafficId);
    await createFilterReference(basicSecurityId, dhcpId);

    const webServerSecurityId = await createFilter(
      'Web Server Security',
      'Security setup for web servers with HTTP/HTTPS access',
      'root'
    );
    await createFilterReference(webServerSecurityId, basicSecurityId);
    const httpFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Provide HTTP' },
    });
    const httpsFilterId = await prisma.nWFilter.findFirst({
      where: { name: 'Provide HTTPS' },
    });
    if (httpFilterId) await createFilterReference(webServerSecurityId, httpFilterId.id);
    if (httpsFilterId) await createFilterReference(webServerSecurityId, httpsFilterId.id);

    console.log('Network filters installed successfully!');
  } catch (error) {
    console.error('Error installing network filters:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the installation
installNetworkFilters().catch(console.error);