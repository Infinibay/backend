import { NonEmptyArray } from 'type-graphql'
import { UserResolver } from './user/resolver'
import { MachineTemplateResolver } from './machine_template/resolver'
import { MachineMutations, MachineQueries } from './machine/resolver'
import { SetupResolver } from '@resolvers/setup/resolver'
import { DepartmentResolver } from '@resolvers/department/resolver'
import { MachineTemplateCategoryResolver } from './machine_template_category/resolver'
import { ApplicationQueries, ApplicationMutations } from './application/resolver'
import { SystemResolver } from './system/resolver'
import { NetworkResolver } from './networks/resolver'
import { FirewallResolver } from './firewall/resolver'
import { SecurityResolver } from './security/resolver'
import { VmDiagnosticsResolver } from './vmDiagnostics/resolver'
import { ISOResolver } from './ISOResolver'
import { SnapshotResolver } from './SnapshotResolver'
import { ServiceResolver } from './ServiceResolver'

const resolvers: NonEmptyArray<Function> = [
  UserResolver,
  MachineTemplateResolver,
  MachineMutations,
  MachineQueries,
  SetupResolver,
  DepartmentResolver,
  MachineTemplateCategoryResolver,
  ApplicationQueries,
  ApplicationMutations,
  SystemResolver,
  NetworkResolver,
  FirewallResolver,
  SecurityResolver,
  VmDiagnosticsResolver,
  ISOResolver,
  SnapshotResolver,
  ServiceResolver
]

export default resolvers as NonEmptyArray<Function>
