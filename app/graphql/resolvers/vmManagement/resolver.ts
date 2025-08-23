import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { VirtManager } from '@utils/VirtManager'
import {
  ServiceInfo,
  PackageInfo,
  VMSnapshot,
  SimplifiedFirewallRule,
  ServiceActionInput,
  PackageActionInput,
  CreateSnapshotInput,
  CreateSimplifiedFirewallRuleInput,
  CommandResult
} from './types'
import { NetworkFilterService } from '@services/networkFilterService'

@Resolver()
export class VMManagementResolver {
  constructor(
    private networkFilterService: NetworkFilterService,
    private virtManager: VirtManager
  ) {}

  @Query(() => [ServiceInfo])
  @Authorized()
  async listVMServices(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ServiceInfo[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const osType = vm.os?.toLowerCase() || ''
    let command = ''

    if (osType.includes('windows')) {
      // PowerShell command to get Windows services
      command = `powershell -Command "Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json"`
    } else {
      // Linux command to get systemd services
      command = `systemctl list-units --type=service --all --no-pager --output=json`
    }

    try {
      const result = await this.virtManager.executeGuestCommand(vm.name, command)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to list services')
      }

      const services = JSON.parse(result.output || '[]')
      
      if (osType.includes('windows')) {
        return services.map((svc: any) => ({
          name: svc.Name,
          displayName: svc.DisplayName || svc.Name,
          status: svc.Status === 4 ? 'running' : svc.Status === 1 ? 'stopped' : 'unknown',
          description: '',
          canStart: svc.Status !== 4,
          canStop: svc.Status === 4,
          canRestart: svc.Status === 4,
          startupType: svc.StartType === 2 ? 'automatic' : svc.StartType === 3 ? 'manual' : 'disabled'
        }))
      } else {
        // Parse systemctl JSON output
        return services.map((svc: any) => ({
          name: svc.unit,
          displayName: svc.description || svc.unit,
          status: svc.active_state,
          description: svc.description,
          canStart: svc.active_state !== 'active',
          canStop: svc.active_state === 'active',
          canRestart: svc.active_state === 'active',
          startupType: svc.unit_file_state
        }))
      }
    } catch (error) {
      console.error('Error listing VM services:', error)
      throw new UserInputError('Failed to list VM services')
    }
  }

  @Query(() => [PackageInfo])
  @Authorized()
  async listVMPackages(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<PackageInfo[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const osType = vm.os?.toLowerCase() || ''
    let command = ''

    if (osType.includes('windows')) {
      // Use winget to list installed packages
      command = `powershell -Command "winget list --accept-source-agreements | ConvertTo-Json"`
    } else if (osType.includes('ubuntu') || osType.includes('debian')) {
      // Use apt for Debian-based systems
      command = `apt list --installed 2>/dev/null | grep -E "^[^/]+" | head -100`
    } else if (osType.includes('rhel') || osType.includes('centos') || osType.includes('fedora')) {
      // Use yum/dnf for RedHat-based systems
      command = `rpm -qa --queryformat '%{NAME}|%{VERSION}|%{SUMMARY}|%{VENDOR}|%{INSTALLTIME}|%{SIZE}\n' | head -100`
    } else {
      // Generic fallback
      command = `which apt >/dev/null 2>&1 && apt list --installed 2>/dev/null | head -100 || rpm -qa 2>/dev/null | head -100`
    }

    try {
      const result = await this.virtManager.executeGuestCommand(vm.name, command)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to list packages')
      }

      const output = result.output || ''
      const packages: PackageInfo[] = []

      if (osType.includes('windows')) {
        // Parse winget output
        try {
          const wingetPackages = JSON.parse(output)
          wingetPackages.forEach((pkg: any) => {
            packages.push({
              name: pkg.Name || pkg.Id,
              version: pkg.Version || 'unknown',
              description: pkg.Description || '',
              publisher: pkg.Publisher || '',
              installDate: '',
              size: 0,
              source: 'winget'
            })
          })
        } catch {
          // Fallback parsing if JSON fails
        }
      } else if (output.includes('|')) {
        // Parse RPM output
        output.split('\n').forEach(line => {
          const parts = line.split('|')
          if (parts.length >= 3) {
            packages.push({
              name: parts[0],
              version: parts[1],
              description: parts[2] || '',
              publisher: parts[3] || '',
              installDate: parts[4] ? new Date(parseInt(parts[4]) * 1000).toISOString() : '',
              size: parseInt(parts[5]) || 0,
              source: 'rpm'
            })
          }
        })
      } else {
        // Parse apt output
        output.split('\n').forEach(line => {
          const match = line.match(/^([^\/]+)\/[^\s]+\s+([^\s]+)/)
          if (match) {
            packages.push({
              name: match[1],
              version: match[2],
              description: '',
              publisher: '',
              installDate: '',
              size: 0,
              source: 'apt'
            })
          }
        })
      }

      return packages
    } catch (error) {
      console.error('Error listing VM packages:', error)
      throw new UserInputError('Failed to list VM packages')
    }
  }

  @Query(() => [VMSnapshot])
  @Authorized()
  async listVMSnapshots(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<VMSnapshot[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      const snapshots = await this.virtManager.listSnapshots(vm.name)
      return snapshots.map(snapshot => ({
        name: snapshot.name,
        description: snapshot.description || '',
        createdAt: snapshot.createdAt,
        state: snapshot.state,
        current: snapshot.current,
        parent: snapshot.parent || undefined
      }))
    } catch (error) {
      console.error('Error listing VM snapshots:', error)
      throw new UserInputError('Failed to list VM snapshots')
    }
  }

  @Mutation(() => CommandResult)
  @Authorized()
  async controlVMService(
    @Arg('input') input: ServiceActionInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<CommandResult> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const osType = vm.os?.toLowerCase() || ''
    let command = ''

    if (osType.includes('windows')) {
      // Windows service control using sc.exe or PowerShell
      switch (input.action) {
        case 'start':
          command = `sc start "${input.serviceName}"`
          break
        case 'stop':
          command = `sc stop "${input.serviceName}"`
          break
        case 'restart':
          command = `powershell -Command "Restart-Service -Name '${input.serviceName}' -Force"`
          break
        case 'enable':
          command = `sc config "${input.serviceName}" start=auto`
          break
        case 'disable':
          command = `sc config "${input.serviceName}" start=disabled`
          break
        default:
          throw new UserInputError('Invalid service action')
      }
    } else {
      // Linux service control using systemctl
      switch (input.action) {
        case 'start':
          command = `systemctl start ${input.serviceName}`
          break
        case 'stop':
          command = `systemctl stop ${input.serviceName}`
          break
        case 'restart':
          command = `systemctl restart ${input.serviceName}`
          break
        case 'enable':
          command = `systemctl enable ${input.serviceName}`
          break
        case 'disable':
          command = `systemctl disable ${input.serviceName}`
          break
        default:
          throw new UserInputError('Invalid service action')
      }
    }

    try {
      const result = await this.virtManager.executeGuestCommand(vm.name, command)
      return {
        success: result.success,
        output: result.output || '',
        error: result.error || '',
        exitCode: result.exitCode || 0
      }
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || 'Failed to control service',
        exitCode: 1
      }
    }
  }

  @Mutation(() => CommandResult)
  @Authorized()
  async manageVMPackage(
    @Arg('input') input: PackageActionInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<CommandResult> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const osType = vm.os?.toLowerCase() || ''
    let command = ''

    if (osType.includes('windows')) {
      // Windows package management using winget
      switch (input.action) {
        case 'install':
          command = `winget install --id ${input.packageName} --accept-package-agreements --accept-source-agreements`
          if (input.version) {
            command += ` --version ${input.version}`
          }
          break
        case 'remove':
          command = `winget uninstall --id ${input.packageName} --silent`
          break
        case 'update':
          command = `winget upgrade --id ${input.packageName} --accept-package-agreements --accept-source-agreements`
          break
        default:
          throw new UserInputError('Invalid package action')
      }
    } else if (osType.includes('ubuntu') || osType.includes('debian')) {
      // Debian-based package management using apt
      switch (input.action) {
        case 'install':
          command = `apt-get install -y ${input.packageName}`
          if (input.version) {
            command = `apt-get install -y ${input.packageName}=${input.version}`
          }
          break
        case 'remove':
          command = `apt-get remove -y ${input.packageName}`
          break
        case 'update':
          command = `apt-get install --only-upgrade -y ${input.packageName}`
          break
        default:
          throw new UserInputError('Invalid package action')
      }
    } else if (osType.includes('rhel') || osType.includes('centos') || osType.includes('fedora')) {
      // RedHat-based package management using yum/dnf
      const pkgManager = osType.includes('fedora') || parseInt(osType.match(/\d+/)?.[0] || '0') >= 8 ? 'dnf' : 'yum'
      switch (input.action) {
        case 'install':
          command = `${pkgManager} install -y ${input.packageName}`
          if (input.version) {
            command = `${pkgManager} install -y ${input.packageName}-${input.version}`
          }
          break
        case 'remove':
          command = `${pkgManager} remove -y ${input.packageName}`
          break
        case 'update':
          command = `${pkgManager} update -y ${input.packageName}`
          break
        default:
          throw new UserInputError('Invalid package action')
      }
    } else {
      throw new UserInputError('Unsupported operating system for package management')
    }

    try {
      const result = await this.virtManager.executeGuestCommand(vm.name, command)
      return {
        success: result.success,
        output: result.output || '',
        error: result.error || '',
        exitCode: result.exitCode || 0
      }
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || 'Failed to manage package',
        exitCode: 1
      }
    }
  }

  @Mutation(() => VMSnapshot)
  @Authorized()
  async createVMSnapshot(
    @Arg('input') input: CreateSnapshotInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<VMSnapshot> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      const snapshot = await this.virtManager.createSnapshot(
        vm.name,
        input.name,
        input.description
      )
      
      return {
        name: snapshot.name,
        description: snapshot.description || '',
        createdAt: new Date(),
        state: 'disk-snapshot',
        current: true,
        parent: undefined
      }
    } catch (error: any) {
      console.error('Error creating VM snapshot:', error)
      throw new UserInputError(error.message || 'Failed to create snapshot')
    }
  }

  @Mutation(() => Boolean)
  @Authorized()
  async revertVMSnapshot(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('snapshotName') snapshotName: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      await this.virtManager.revertSnapshot(vm.name, snapshotName)
      return true
    } catch (error: any) {
      console.error('Error reverting VM snapshot:', error)
      throw new UserInputError(error.message || 'Failed to revert snapshot')
    }
  }

  @Mutation(() => Boolean)
  @Authorized()
  async deleteVMSnapshot(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('snapshotName') snapshotName: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      await this.virtManager.deleteSnapshot(vm.name, snapshotName)
      return true
    } catch (error: any) {
      console.error('Error deleting VM snapshot:', error)
      throw new UserInputError(error.message || 'Failed to delete snapshot')
    }
  }

  @Query(() => [SimplifiedFirewallRule])
  @Authorized()
  async getVMFirewallRules(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<SimplifiedFirewallRule[]> {
    // Get VM's network filters
    const vm = await prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        nwFilters: {
          include: {
            nwFilter: {
              include: {
                rules: true
              }
            }
          }
        }
      }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const simplifiedRules: SimplifiedFirewallRule[] = []
    
    // Convert complex NWFilter rules to simplified format
    vm.nwFilters.forEach(vmFilter => {
      if (vmFilter.nwFilter?.rules) {
        vmFilter.nwFilter.rules.forEach((rule: any) => {
          simplifiedRules.push({
            id: rule.id,
            name: `${rule.protocol || 'all'}_${rule.direction}_${rule.action}`,
            direction: rule.direction || 'inbound',
            action: rule.action || 'accept',
            protocol: rule.protocol,
            port: rule.dstPortStart,
            portRange: rule.dstPortStart && rule.dstPortEnd 
              ? `${rule.dstPortStart}-${rule.dstPortEnd}` 
              : undefined,
            sourceIp: rule.srcIpAddr,
            destinationIp: rule.dstIpAddr,
            application: undefined,
            priority: rule.priority || 1000,
            enabled: true
          })
        })
      }
    })

    return simplifiedRules
  }

  @Mutation(() => SimplifiedFirewallRule)
  @Authorized('ADMIN')
  async createVMFirewallRule(
    @Arg('input') input: CreateSimplifiedFirewallRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<SimplifiedFirewallRule> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId },
      include: {
        nwFilters: {
          include: {
            nwFilter: true
          }
        }
      }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    // Get the first VM filter or create one
    const vmFilter = vm.nwFilters[0]
    let filterId = vmFilter?.nwFilterId
    if (!filterId) {
      // Create a new filter for this VM
      const filter = await this.networkFilterService.createFilter(
        `vm_${vm.name}_filter`,
        `Firewall rules for VM ${vm.name}`,
        'root',
        'vm'
      )
      filterId = filter.id
      
      // Associate filter with VM
      await prisma.vMNWFilter.create({
        data: {
          vmId: vm.id,
          nwFilterId: filterId
        }
      })
    }

    // Create the actual firewall rule
    const rule = await this.networkFilterService.createRule(
      filterId,
      input.action || 'accept',
      input.direction || 'inbound',
      input.priority || 1000,
      input.protocol || 'all',
      input.port,
      {
        srcIpAddr: input.sourceIp,
        dstIpAddr: input.destinationIp,
        dstPortStart: input.port,
        dstPortEnd: input.port,
        comment: input.name
      }
    )

    return {
      id: rule.id,
      name: input.name,
      direction: input.direction,
      action: input.action,
      protocol: input.protocol,
      port: input.port,
      portRange: input.portRange,
      sourceIp: input.sourceIp,
      destinationIp: input.destinationIp,
      application: input.application,
      priority: input.priority || 1000,
      enabled: input.enabled !== false
    }
  }
}