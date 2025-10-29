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
import { VmDiagnosticsResolver } from './vmDiagnostics/resolver'
import { ISOResolver } from './ISOResolver'
import { SnapshotResolver } from './SnapshotResolver'
import { PackageResolver } from './PackageResolver'
import { ProcessResolver } from './ProcessResolver'
import { MetricsResolver } from './metrics/resolver'
import { AutoCheckResolver } from './AutoCheckResolver'
import { VMHealthHistoryResolver } from './VMHealthHistoryResolver'
import { BackgroundHealthResolver } from './health/BackgroundHealthResolver'
import { MaintenanceResolver } from './MaintenanceResolver'
import { VMRecommendationResolver } from './VMRecommendationResolver'
// Import recommendation types to ensure they're registered
import '../types/RecommendationTypes'
import { AppSettingsResolver } from './AppSettingsResolver'
import { FirewallResolver } from './firewall/resolver'
import { ScriptResolver } from './scripts/resolver'

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
  VmDiagnosticsResolver,
  ISOResolver,
  SnapshotResolver,
  PackageResolver,
  ProcessResolver,
  MetricsResolver,
  AutoCheckResolver,
  VMHealthHistoryResolver,
  VMRecommendationResolver,
  BackgroundHealthResolver,
  MaintenanceResolver,
  AppSettingsResolver,
  FirewallResolver,
  ScriptResolver
]

export default resolvers as NonEmptyArray<Function>
