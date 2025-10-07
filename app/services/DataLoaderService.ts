import DataLoader from 'dataloader'
import {
  PrismaClient,
  User,
  MachineTemplate,
  Department,
  Application,
  ProcessSnapshot,
  SystemMetrics,
  MachineConfiguration,
  Machine
} from '@prisma/client'

export class DataLoaderService {
  private userLoader: DataLoader<string, User | null>
  private templateLoader: DataLoader<string, MachineTemplate | null>
  private departmentLoader: DataLoader<string, Department | null>
  private applicationLoader: DataLoader<string, Application | null>
  private processSnapshotLoader: DataLoader<string, ProcessSnapshot | null>
  private systemMetricsLoader: DataLoader<string, SystemMetrics | null>
  private machineConfigurationLoader: DataLoader<string, MachineConfiguration | null>
  private machineLoader: DataLoader<string, Machine | null>

  constructor (private prisma: PrismaClient) {
    this.userLoader = new DataLoader(async (ids) => {
      const users = await prisma.user.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => users.find(u => u.id === id) || null)
    })

    this.templateLoader = new DataLoader(async (ids) => {
      const templates = await prisma.machineTemplate.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => templates.find(t => t.id === id) || null)
    })

    this.departmentLoader = new DataLoader(async (ids) => {
      const departments = await prisma.department.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => departments.find(d => d.id === id) || null)
    })

    this.applicationLoader = new DataLoader(async (ids) => {
      const applications = await prisma.application.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => applications.find(a => a.id === id) || null)
    })

    this.processSnapshotLoader = new DataLoader(async (ids) => {
      const snapshots = await prisma.processSnapshot.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => snapshots.find(s => s.id === id) || null)
    })

    this.systemMetricsLoader = new DataLoader(async (ids) => {
      const metrics = await prisma.systemMetrics.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => metrics.find(m => m.id === id) || null)
    })

    this.machineConfigurationLoader = new DataLoader(async (ids) => {
      const configs = await prisma.machineConfiguration.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => configs.find(c => c.id === id) || null)
    })

    this.machineLoader = new DataLoader(async (ids) => {
      const machines = await prisma.machine.findMany({
        where: { id: { in: ids as string[] } }
      })
      return ids.map(id => machines.find(m => m.id === id) || null)
    })
  }

  async loadUser (id: string | null): Promise<User | null> {
    if (!id) return null
    return this.userLoader.load(id)
  }

  async loadTemplate (id: string | null): Promise<MachineTemplate | null> {
    if (!id) return null
    return this.templateLoader.load(id)
  }

  async loadDepartment (id: string | null): Promise<Department | null> {
    if (!id) return null
    return this.departmentLoader.load(id)
  }

  async loadApplication (id: string | null): Promise<Application | null> {
    if (!id) return null
    return this.applicationLoader.load(id)
  }

  async loadProcessSnapshot (id: string | null): Promise<ProcessSnapshot | null> {
    if (!id) return null
    return this.processSnapshotLoader.load(id)
  }

  async loadSystemMetrics (id: string | null): Promise<SystemMetrics | null> {
    if (!id) return null
    return this.systemMetricsLoader.load(id)
  }

  async loadMachineConfiguration (id: string | null): Promise<MachineConfiguration | null> {
    if (!id) return null
    return this.machineConfigurationLoader.load(id)
  }

  async loadMachine (id: string | null): Promise<Machine | null> {
    if (!id) return null
    return this.machineLoader.load(id)
  }

  clearAll (): void {
    this.userLoader.clearAll()
    this.templateLoader.clearAll()
    this.departmentLoader.clearAll()
    this.applicationLoader.clearAll()
    this.processSnapshotLoader.clearAll()
    this.systemMetricsLoader.clearAll()
    this.machineConfigurationLoader.clearAll()
    this.machineLoader.clearAll()
  }

  clear (loaderName: 'user' | 'template' | 'department' | 'application' | 'processSnapshot' | 'systemMetrics' | 'machineConfiguration' | 'machine'): void {
    switch (loaderName) {
    case 'user':
      this.userLoader.clearAll()
      break
    case 'template':
      this.templateLoader.clearAll()
      break
    case 'department':
      this.departmentLoader.clearAll()
      break
    case 'application':
      this.applicationLoader.clearAll()
      break
    case 'processSnapshot':
      this.processSnapshotLoader.clearAll()
      break
    case 'systemMetrics':
      this.systemMetricsLoader.clearAll()
      break
    case 'machineConfiguration':
      this.machineConfigurationLoader.clearAll()
      break
    case 'machine':
      this.machineLoader.clearAll()
      break
    }
  }
}
