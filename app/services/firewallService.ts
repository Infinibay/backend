import { PrismaClient, Machine, VmPort } from '@prisma/client';
import { VmPortInfo } from '../graphql/resolvers/firewall/types';

export class FirewallService {
  constructor(private prisma: PrismaClient) {}

  async getVmPorts(): Promise<VmPortInfo[]> {
    const machines = await this.prisma.machine.findMany({
      include: {
        ports: {
          where: {
            OR: [
              { running: true },
              { enabled: true },
              { toEnable: true }
            ]
          }
        },
      },
    });

    return machines.map((machine) => ({
      vmId: machine.id,
      name: machine.name,
      ports: machine.ports.map((port) => ({
        portStart: port.portStart,
        portEnd: port.portEnd,
        protocol: port.protocol,
        running: port.running,
        enabled: port.enabled,
        toEnable: port.toEnable,
        lastSeen: port.lastSeen,
      })),
    }));
  }

  async getVmPortsByDepartment(departmentId: string): Promise<VmPortInfo[]> {
    const machines = await this.prisma.machine.findMany({
      where: {
        departmentId,
      },
      include: {
        ports: {
          where: {
            OR: [
              { running: true },
              { enabled: true },
              { toEnable: true }
            ]
          }
        },
      },
    });

    console.log(machines[1].ports);
    // fina ll vmPorts (no conditino or where, just all)
    let allPorts = await this.prisma.vmPort.findMany({})
    console.log(allPorts);

    return machines.map((machine) => ({
      vmId: machine.id,
      name: machine.name,
      ports: machine.ports.map((port) => ({
        portStart: port.portStart,
        portEnd: port.portEnd,
        protocol: port.protocol,
        running: port.running,
        enabled: port.enabled,
        toEnable: port.toEnable,
        lastSeen: port.lastSeen,
      })),
    }));
  }
}
