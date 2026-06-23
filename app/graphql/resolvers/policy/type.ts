import { Field, ID, InputType, Int, ObjectType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { DepartmentRole, GrantEffect, PermissionScope } from '@prisma/client'
import { UserRole } from '../user/type'

registerEnumType(PermissionScope, {
  name: 'PermissionScope',
  description: 'Scope a permission grant applies at (own / department / any)'
})

registerEnumType(GrantEffect, {
  name: 'GrantEffect',
  description: 'Allow or deny effect for a per-user permission override'
})

registerEnumType(DepartmentRole, {
  name: 'DepartmentRole',
  description: 'Role a user holds within a single department'
})

// ---------------------------------------------------------------------------
// Permission registry (catalog of resources/verbs/groups for the editor)
// ---------------------------------------------------------------------------

@ObjectType()
export class PermissionResourceDefType {
  @Field() key: string = ''
  @Field() label: string = ''
  @Field() group: string = ''
  @Field() scoped: boolean = false
  @Field(() => [String]) verbs: string[] = []
}

@ObjectType()
export class PermissionGroupType {
  @Field() key: string = ''
  @Field(() => [String]) members: string[] = []
}

@ObjectType()
export class PermissionRegistryType {
  @Field(() => [PermissionResourceDefType]) resources: PermissionResourceDefType[] = []
  @Field(() => [PermissionGroupType]) groups: PermissionGroupType[] = []
}

// ---------------------------------------------------------------------------
// Roles, grants, overrides
// ---------------------------------------------------------------------------

@ObjectType()
export class PermissionGrantType {
  @Field() permission: string = ''
  @Field(() => PermissionScope) scope: PermissionScope = PermissionScope.ANY
}

@ObjectType()
export class RoleType {
  @Field(() => ID) id: string = ''
  @Field() key: string = ''
  @Field() name: string = ''
  @Field({ nullable: true }) description?: string
  @Field() isSystem: boolean = false
  @Field(() => Int) priority: number = 0
  @Field(() => [PermissionGrantType]) permissions: PermissionGrantType[] = []
  @Field(() => Int) userCount: number = 0
}

@ObjectType()
export class UserPermissionOverrideType {
  @Field(() => ID) id: string = ''
  @Field() userId: string = ''
  @Field() permission: string = ''
  @Field(() => PermissionScope) scope: PermissionScope = PermissionScope.ANY
  @Field(() => GrantEffect) effect: GrantEffect = GrantEffect.ALLOW
}

@ObjectType()
export class EffectivePermissionsType {
  @Field(() => [PermissionGrantType]) grants: PermissionGrantType[] = []
  // Legacy nav-resource set kept for the sidebar / route guard.
  @Field(() => [String]) allowedResources: string[] = []
}

@InputType()
export class GrantInput {
  @Field() permission: string = ''
  @Field(() => PermissionScope, { nullable: true, defaultValue: PermissionScope.ANY }) scope: PermissionScope = PermissionScope.ANY
}

@InputType()
export class CreateRoleInput {
  @Field() name: string = ''
  @Field({ nullable: true }) description?: string
  @Field(() => [GrantInput], { nullable: true }) permissions?: GrantInput[]
}

@InputType()
export class UpdateRoleInput {
  @Field(() => ID) id: string = ''
  @Field({ nullable: true }) name?: string
  @Field({ nullable: true }) description?: string
}

@InputType()
export class SetRolePermissionInput {
  @Field(() => ID) roleId: string = ''
  @Field() permission: string = ''
  @Field(() => PermissionScope, { nullable: true, defaultValue: PermissionScope.ANY }) scope: PermissionScope = PermissionScope.ANY
}

@InputType()
export class RemoveRolePermissionInput {
  @Field(() => ID) roleId: string = ''
  @Field() permission: string = ''
}

@InputType()
export class AssignUserRoleInput {
  @Field(() => ID) userId: string = ''
  @Field(() => ID) roleId: string = ''
}

@InputType()
export class SetUserPermissionOverrideInput {
  @Field(() => ID) userId: string = ''
  @Field() permission: string = ''
  @Field(() => PermissionScope, { nullable: true, defaultValue: PermissionScope.ANY }) scope: PermissionScope = PermissionScope.ANY
  @Field(() => GrantEffect, { nullable: true, defaultValue: GrantEffect.ALLOW }) effect: GrantEffect = GrantEffect.ALLOW
}

// ---------------------------------------------------------------------------
// Department-scoped roles (department membership management — unchanged)
// ---------------------------------------------------------------------------

@ObjectType()
export class DepartmentMemberType {
  @Field(() => ID) id: string = ''
  @Field() departmentId: string = ''
  @Field() userId: string = ''
  @Field(() => DepartmentRole) role: DepartmentRole = DepartmentRole.MEMBER
  @Field() userEmail: string = ''
  @Field() userName: string = ''
  @Field(() => UserRole) userGlobalRole: UserRole = UserRole.USER
}

@InputType()
export class SetDepartmentMemberInput {
  @Field() departmentId: string = ''
  @Field() userId: string = ''
  @Field(() => DepartmentRole) role: DepartmentRole = DepartmentRole.MEMBER
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

@ObjectType()
export class PolicyAuditEntryType {
  @Field(() => ID) id: string = ''
  @Field({ nullable: true }) actorId?: string
  @Field({ nullable: true }) actorName?: string
  @Field() action: string = ''
  @Field() targetType: string = ''
  @Field({ nullable: true }) targetId?: string
  @Field() summary: string = ''
  @Field(() => GraphQLJSONObject, { nullable: true }) metadata?: Record<string, unknown>
  @Field() createdAt: Date = new Date()
}

@InputType()
export class PolicyAuditQueryInput {
  @Field(() => Int, { nullable: true, defaultValue: 100 }) limit?: number = 100
}
