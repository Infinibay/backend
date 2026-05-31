import { PermissionEffect, PrismaClient, UserRole } from '@prisma/client'

export interface PermissionPrincipal {
  id: UserRole
  label: string
  kind: 'role'
  avatar: string
}

export interface PermissionResource {
  id: string
  label: string
  group: string
}

export interface RolePermissionMatrix {
  principals: PermissionPrincipal[]
  resources: PermissionResource[]
  permissions: Record<string, 'allow' | 'deny'>
}

export const ROLE_PRINCIPALS: PermissionPrincipal[] = [
  { id: UserRole.SUPER_ADMIN, label: 'Super admin', kind: 'role', avatar: 'SA' },
  { id: UserRole.ADMIN, label: 'Admin', kind: 'role', avatar: 'AD' },
  { id: UserRole.USER, label: 'User', kind: 'role', avatar: 'US' }
]

export const PERMISSION_RESOURCES: PermissionResource[] = [
  { id: 'overview', label: 'Overview', group: 'Operate' },
  { id: 'desktops', label: 'Desktops', group: 'Operate' },
  { id: 'workspace', label: 'Workspace', group: 'Operate' },
  { id: 'infrastructure', label: 'Infrastructure', group: 'Operate' },
  { id: 'departments', label: 'Departments', group: 'Operate' },
  { id: 'blueprints', label: 'Blueprints', group: 'Operate' },
  { id: 'applications', label: 'Applications', group: 'Operate' },
  { id: 'firewall', label: 'Firewall', group: 'Operate' },
  { id: 'scripts', label: 'Scripts', group: 'Operate' },
  { id: 'users', label: 'Users', group: 'Admin' },
  { id: 'identity', label: 'Identity', group: 'Admin' },
  { id: 'policies', label: 'Policies', group: 'Admin' },
  { id: 'settings', label: 'Settings', group: 'Admin' }
]

const DEFAULT_PERMISSIONS: Record<string, PermissionEffect> = {
  'SUPER_ADMIN:overview': PermissionEffect.ALLOW,
  'SUPER_ADMIN:desktops': PermissionEffect.ALLOW,
  'SUPER_ADMIN:workspace': PermissionEffect.ALLOW,
  'SUPER_ADMIN:infrastructure': PermissionEffect.ALLOW,
  'SUPER_ADMIN:departments': PermissionEffect.ALLOW,
  'SUPER_ADMIN:blueprints': PermissionEffect.ALLOW,
  'SUPER_ADMIN:applications': PermissionEffect.ALLOW,
  'SUPER_ADMIN:firewall': PermissionEffect.ALLOW,
  'SUPER_ADMIN:scripts': PermissionEffect.ALLOW,
  'SUPER_ADMIN:users': PermissionEffect.ALLOW,
  'SUPER_ADMIN:identity': PermissionEffect.ALLOW,
  'SUPER_ADMIN:policies': PermissionEffect.ALLOW,
  'SUPER_ADMIN:settings': PermissionEffect.ALLOW,
  'ADMIN:overview': PermissionEffect.ALLOW,
  'ADMIN:desktops': PermissionEffect.ALLOW,
  'ADMIN:workspace': PermissionEffect.ALLOW,
  'ADMIN:infrastructure': PermissionEffect.ALLOW,
  'ADMIN:departments': PermissionEffect.ALLOW,
  'ADMIN:blueprints': PermissionEffect.ALLOW,
  'ADMIN:applications': PermissionEffect.ALLOW,
  'ADMIN:firewall': PermissionEffect.ALLOW,
  'ADMIN:scripts': PermissionEffect.ALLOW,
  'ADMIN:users': PermissionEffect.ALLOW,
  'ADMIN:identity': PermissionEffect.ALLOW,
  'ADMIN:policies': PermissionEffect.ALLOW,
  'ADMIN:settings': PermissionEffect.ALLOW,
  'USER:overview': PermissionEffect.DENY,
  'USER:desktops': PermissionEffect.DENY,
  'USER:workspace': PermissionEffect.ALLOW,
  'USER:infrastructure': PermissionEffect.DENY,
  'USER:departments': PermissionEffect.DENY,
  'USER:blueprints': PermissionEffect.DENY,
  'USER:applications': PermissionEffect.DENY,
  'USER:firewall': PermissionEffect.DENY,
  'USER:scripts': PermissionEffect.DENY,
  'USER:users': PermissionEffect.DENY,
  'USER:identity': PermissionEffect.DENY,
  'USER:policies': PermissionEffect.DENY,
  'USER:settings': PermissionEffect.DENY
}

function permissionKey (role: UserRole, resource: string): string {
  return `${role}:${resource}`
}

function toMatrixEffect (effect: PermissionEffect): 'allow' | 'deny' {
  return effect === PermissionEffect.ALLOW ? 'allow' : 'deny'
}

export class RolePermissionService {
  constructor (private readonly prisma: PrismaClient) {}

  async canAccess (role: UserRole, resource: string): Promise<boolean> {
    if (role === UserRole.SUPER_ADMIN) return true

    const override = await this.prisma.rolePermission.findUnique({
      where: {
        role_resource: { role, resource }
      }
    })
    const effect = override?.effect && override.effect !== PermissionEffect.INHERIT
      ? override.effect
      : DEFAULT_PERMISSIONS[permissionKey(role, resource)] ?? PermissionEffect.DENY

    return effect === PermissionEffect.ALLOW
  }

  async allowedResources (role: UserRole): Promise<string[]> {
    const allowed: string[] = []

    for (const resource of PERMISSION_RESOURCES) {
      if (await this.canAccess(role, resource.id)) {
        allowed.push(resource.id)
      }
    }

    return allowed
  }

  async matrix (): Promise<RolePermissionMatrix> {
    const overrides = await this.prisma.rolePermission.findMany()
    const permissions: Record<string, 'allow' | 'deny'> = {}

    for (const principal of ROLE_PRINCIPALS) {
      for (const resource of PERMISSION_RESOURCES) {
        const key = permissionKey(principal.id, resource.id)
        permissions[key] = toMatrixEffect(DEFAULT_PERMISSIONS[key] ?? PermissionEffect.DENY)
      }
    }

    for (const override of overrides) {
      permissions[permissionKey(override.role, override.resource)] = toMatrixEffect(override.effect)
    }

    return {
      principals: ROLE_PRINCIPALS,
      resources: PERMISSION_RESOURCES,
      permissions
    }
  }

  async setPermission (role: UserRole, resource: string, effect: PermissionEffect): Promise<RolePermissionMatrix> {
    const resourceExists = PERMISSION_RESOURCES.some((item) => item.id === resource)
    if (!resourceExists) {
      throw new Error(`Unknown permission resource: ${resource}`)
    }
    if (role === UserRole.SUPER_ADMIN && effect !== PermissionEffect.ALLOW && effect !== PermissionEffect.INHERIT) {
      throw new Error('SUPER_ADMIN permissions cannot be denied')
    }

    if (effect === PermissionEffect.INHERIT) {
      await this.prisma.rolePermission.deleteMany({
        where: { role, resource }
      })
      return this.matrix()
    }

    await this.prisma.rolePermission.upsert({
      where: {
        role_resource: { role, resource }
      },
      create: { role, resource, effect },
      update: { effect }
    })

    return this.matrix()
  }
}
