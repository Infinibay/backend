import { CronJob } from 'cron';
import { PrismaClient, Machine as PrismaMachine } from '@prisma/client';
import { Connection, Machine as LibvirtMachine, VirDomainXMLFlags } from 'libvirt-node';
import { DOMParser } from 'xmldom';
import { networkInterfaces } from 'systeminformation';

const prisma = new PrismaClient();

// Cache the local IP to avoid frequent lookups
let cachedLocalIP: string | null = null;

async function getLocalIP(): Promise<string> {
  if (cachedLocalIP) return cachedLocalIP;
  
  try {
    const networkData = await networkInterfaces();
    // Handle both single object and array cases
    const interfaces = Array.isArray(networkData) ? networkData : [networkData];
    
    // Look for the first non-internal IPv4 address
    for (const iface of interfaces) {
      if (!iface.internal && iface.ip4) {
        cachedLocalIP = iface.ip4;
        return iface.ip4;
      }
    }
    throw new Error('No suitable network interface found');
  } catch (err) {
    console.error('Error getting local IP:', err);
    return '127.0.0.1'; // Fallback to localhost
  }
}

const UpdateGraphicsInformationJob = new CronJob('*/1 * * * *', async () => {
  try {
    // Connect to libvirt
    const conn = Connection.open('qemu:///system');
    if (!conn) {
      console.error('Failed to connect to libvirt');
      return;
    }

    // Get all machines from database
    const machines = await prisma.machine.findMany({
      include: {
        configuration: true
      }
    });
    
    // Process each machine
    for (const machine of machines) {
      try {
        // Look up the domain
        const domain = LibvirtMachine.lookupByName(conn, machine.internalName);
        if (!domain) {
          console.error(`Failed to find domain: ${machine.name}`);
          continue;
        }

        // Get domain state
        const state = domain.getState();
        const isRunning = state && state.result === 1; // 1 = VIR_DOMAIN_RUNNING

        // Default port to -1 (not available)
        let graphicPort = -1;
        let graphicProtocol: string | null = null;
        let graphicPassword: string | null = null;
        let graphicHost: string | null = null;

        if (isRunning) {
          // Get domain XML description
          const xml = domain.getXmlDesc(VirDomainXMLFlags.VirDomainXMLSecure);
          if (xml) {
            // Parse XML to find graphics port
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');
            
            // Look for both SPICE and VNC graphics
            const graphicsElements = doc.getElementsByTagName('graphics');
            for (let i = 0; i < graphicsElements.length; i++) {
              const graphics = graphicsElements.item(i);
              if (graphics) {
                const type = graphics.getAttribute('type');
                
                if (type === 'spice' || type === 'vnc') {
                  const port = graphics.getAttribute('port');
                  if (port && !isNaN(parseInt(port))) {
                    graphicPort = parseInt(port);
                    graphicProtocol = type;
                    graphicPassword = graphics.getAttribute('passwd') || null;
                    
                    // Get host from listen attribute
                    const listenElements = graphics.getElementsByTagName('listen');
                    let foundHost = null;
                    for (let j = 0; j < listenElements.length; j++) {
                      const listen = listenElements.item(j);
                      if (listen && listen.getAttribute('type') === 'address') {
                        foundHost = listen.getAttribute('address') || null;
                        break;
                      }
                    }
                    
                    // If host is 0.0.0.0 or not set, use local IP
                    if (!foundHost || foundHost === '0.0.0.0') {
                      graphicHost = await getLocalIP();
                    } else {
                      graphicHost = foundHost;
                    }
                    break;
                  }
                }
              }
            }
          }
        }

        // Update or create machine configuration
        if (machine.configuration) {
          await prisma.machineConfiguration.update({
            where: { id: machine.configuration.id },
            data: {
              graphicPort,
              graphicProtocol,
              graphicPassword,
              graphicHost
            }
          });
        } else {
          await prisma.machineConfiguration.create({
            data: {
              machineId: machine.id,
              graphicPort,
              graphicProtocol,
              graphicPassword,
              graphicHost
            }
          });
        }

      } catch (err) {
        console.error(`Error processing machine ${machine.name}:`, err);
      }
    }

    // Close libvirt connection
    conn.close();

  } catch (err) {
    console.error('Error in UpdateVmStatusJob:', err);
  }
});

export default UpdateGraphicsInformationJob;