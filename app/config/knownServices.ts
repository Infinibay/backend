/**
 * Known Services Configuration
 * 
 * This file defines network services with their properties, risk levels, and port information.
 * It serves as the foundation for the security service management system.
 */

export enum ServiceRiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH"
}

export interface ServicePort {
  protocol: string;
  portStart: number;
  portEnd: number;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  ports: ServicePort[];
  riskLevel: ServiceRiskLevel;
  riskDescription: string;
}

/**
 * Complete list of known network services
 */
export const KNOWN_SERVICES: ServiceDefinition[] = [
  {
    id: "ssh",
    name: "SSH",
    displayName: "Secure Shell",
    description: "Secure remote terminal access protocol",
    ports: [{ protocol: "tcp", portStart: 22, portEnd: 22 }],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Allows remote command execution and file transfer; requires strong authentication"
  },
  {
    id: "rdp",
    name: "RDP",
    displayName: "Remote Desktop",
    description: "Windows remote desktop access protocol",
    ports: [{ protocol: "tcp", portStart: 3389, portEnd: 3389 }],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Provides full remote desktop access to Windows systems; requires proper authentication"
  },
  {
    id: "http",
    name: "HTTP",
    displayName: "Web (HTTP)",
    description: "Hypertext Transfer Protocol for web access",
    ports: [{ protocol: "tcp", portStart: 80, portEnd: 80 }],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Unencrypted web traffic; sensitive data should not be transmitted"
  },
  {
    id: "https",
    name: "HTTPS",
    displayName: "Secure Web (HTTPS)",
    description: "Secure HTTP for encrypted web access",
    ports: [{ protocol: "tcp", portStart: 443, portEnd: 443 }],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Encrypted web traffic; safer for transmitting sensitive data"
  },
  {
    id: "dns",
    name: "DNS",
    displayName: "Domain Name System",
    description: "Domain name resolution service",
    ports: [
      { protocol: "tcp", portStart: 53, portEnd: 53 },
      { protocol: "udp", portStart: 53, portEnd: 53 }
    ],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Essential for network operation; potential for DNS-based attacks if misconfigured"
  },
  {
    id: "smtp",
    name: "SMTP",
    displayName: "Mail Transfer",
    description: "Email sending protocol",
    ports: [
      { protocol: "tcp", portStart: 25, portEnd: 25 },
      { protocol: "tcp", portStart: 587, portEnd: 587 }
    ],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Email server that can send mail; could be abused for spam if not secured properly"
  },
  {
    id: "smtps",
    name: "SMTPS",
    displayName: "Secure Mail Transfer",
    description: "Encrypted email sending protocol",
    ports: [{ protocol: "tcp", portStart: 465, portEnd: 465 }],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Encrypted email server; more secure than standard SMTP"
  },
  {
    id: "pop3",
    name: "POP3",
    displayName: "Mail Retrieval (POP3)",
    description: "Email retrieval protocol",
    ports: [{ protocol: "tcp", portStart: 110, portEnd: 110 }],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Unencrypted email retrieval; passwords and emails transmitted in clear text"
  },
  {
    id: "pop3s",
    name: "POP3S",
    displayName: "Secure Mail Retrieval (POP3S)",
    description: "Encrypted email retrieval protocol",
    ports: [{ protocol: "tcp", portStart: 995, portEnd: 995 }],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Encrypted email retrieval; more secure than standard POP3"
  },
  {
    id: "imap",
    name: "IMAP",
    displayName: "Mail Access (IMAP)",
    description: "Interactive email access protocol",
    ports: [{ protocol: "tcp", portStart: 143, portEnd: 143 }],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Unencrypted interactive email access; passwords and emails transmitted in clear text"
  },
  {
    id: "imaps",
    name: "IMAPS",
    displayName: "Secure Mail Access (IMAPS)",
    description: "Encrypted interactive email access protocol",
    ports: [{ protocol: "tcp", portStart: 993, portEnd: 993 }],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Encrypted interactive email access; more secure than standard IMAP"
  },
  {
    id: "ftp",
    name: "FTP",
    displayName: "File Transfer",
    description: "File Transfer Protocol for sharing files",
    ports: [
      { protocol: "tcp", portStart: 21, portEnd: 21 },
      { protocol: "tcp", portStart: 1024, portEnd: 65535 } // Passive mode
    ],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "Unencrypted file transfer; credentials and data transmitted in clear text"
  },
  {
    id: "ftps",
    name: "FTPS",
    displayName: "Secure File Transfer",
    description: "Encrypted file transfer protocol",
    ports: [
      { protocol: "tcp", portStart: 990, portEnd: 990 },
      { protocol: "tcp", portStart: 1024, portEnd: 65535 } // Passive mode
    ],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Encrypted file transfer; more secure than standard FTP"
  },
  {
    id: "mysql",
    name: "MySQL",
    displayName: "MySQL Database",
    description: "MySQL database server access",
    ports: [{ protocol: "tcp", portStart: 3306, portEnd: 3306 }],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "Database access that could expose data if not properly secured"
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    displayName: "PostgreSQL Database",
    description: "PostgreSQL database server access",
    ports: [{ protocol: "tcp", portStart: 5432, portEnd: 5432 }],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "Database access that could expose data if not properly secured"
  },
  {
    id: "mongodb",
    name: "MongoDB",
    displayName: "MongoDB Database",
    description: "MongoDB database server access",
    ports: [{ protocol: "tcp", portStart: 27017, portEnd: 27017 }],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "Database access that could expose data if not properly secured"
  },
  {
    id: "redis",
    name: "Redis",
    displayName: "Redis Database",
    description: "Redis in-memory data structure store",
    ports: [{ protocol: "tcp", portStart: 6379, portEnd: 6379 }],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "In-memory database that could expose data if not properly secured"
  },
  {
    id: "openvpn",
    name: "OpenVPN",
    displayName: "OpenVPN",
    description: "Virtual private network service",
    ports: [
      { protocol: "udp", portStart: 1194, portEnd: 1194 },
      { protocol: "tcp", portStart: 1194, portEnd: 1194 }
    ],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "Encrypted tunneling service; could provide unauthorized network access if misconfigured"
  },
  {
    id: "steam",
    name: "Steam",
    displayName: "Steam Gaming",
    description: "Steam gaming platform",
    ports: [
      { protocol: "tcp", portStart: 27015, portEnd: 27015 },
      { protocol: "udp", portStart: 27015, portEnd: 27015 },
      { protocol: "tcp", portStart: 27036, portEnd: 27037 },
      { protocol: "udp", portStart: 27036, portEnd: 27036 },
      { protocol: "tcp", portStart: 27031, portEnd: 27031 }
    ],
    riskLevel: ServiceRiskLevel.LOW,
    riskDescription: "Gaming platform that requires various ports for different features"
  },
  {
    id: "cpanel",
    name: "cPanel",
    displayName: "cPanel Control Panel",
    description: "Web hosting control panel",
    ports: [
      { protocol: "tcp", portStart: 2082, portEnd: 2082 },
      { protocol: "tcp", portStart: 2083, portEnd: 2083 }
    ],
    riskLevel: ServiceRiskLevel.HIGH,
    riskDescription: "Administrative interface that provides complete control over hosting account"
  },
  {
    id: "bittorrent",
    name: "BitTorrent",
    displayName: "BitTorrent",
    description: "Peer-to-peer file sharing protocol",
    ports: [
      { protocol: "tcp", portStart: 6881, portEnd: 6881 },
      { protocol: "udp", portStart: 6881, portEnd: 6881 }
    ],
    riskLevel: ServiceRiskLevel.MEDIUM,
    riskDescription: "File sharing that may expose the system to inappropriate content and legal risks"
  }
];

/**
 * Utility function to get a service by its ID
 */
export function getServiceById(id: string): ServiceDefinition | undefined {
  return KNOWN_SERVICES.find(s => s.id === id);
}

/**
 * Utility function to get services by port number and protocol
 */
export function getServicesByPort(port: number, protocol: string): ServiceDefinition[] {
  return KNOWN_SERVICES.filter(s => 
    s.ports.some(p => 
      p.protocol === protocol && 
      port >= p.portStart && 
      port <= p.portEnd
    )
  );
}

/**
 * Utility function to get services by risk level
 */
export function getServicesByRiskLevel(level: ServiceRiskLevel): ServiceDefinition[] {
  return KNOWN_SERVICES.filter(s => s.riskLevel === level);
}