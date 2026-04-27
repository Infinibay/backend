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
import { BackupResolver } from './BackupResolver'
import { PackageResolver } from './PackageResolver'
import { ProcessResolver } from './ProcessResolver'
import { MetricsResolver } from './metrics/resolver'
import { AutoCheckResolver } from './AutoCheckResolver'
import { VMHealthHistoryResolver } from './VMHealthHistoryResolver'
import { BackgroundHealthResolver } from './health/BackgroundHealthResolver'
import { MaintenanceResolver } from './MaintenanceResolver'
import { VMRecommendationResolver } from './VMRecommendationResolver'
import { RecommendationResolutionResolver } from './RecommendationResolutionResolver'
// Import recommendation types to ensure they're registered
import '../types/RecommendationTypes'
import '../types/RecommendationResolutionTypes'
import { AppSettingsResolver } from './AppSettingsResolver'
import { FirewallResolver } from './firewall/resolver'
import { ScriptResolver } from './scripts/resolver'
import { PluginPackageResolver } from './plugin-package'
import { GoldenImageResolver } from './goldenImage/resolver'
import { PoolResolver } from './pool/resolver'

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
  BackupResolver,
  PackageResolver,
  ProcessResolver,
  MetricsResolver,
  AutoCheckResolver,
  VMHealthHistoryResolver,
  VMRecommendationResolver,
  RecommendationResolutionResolver,
  BackgroundHealthResolver,
  MaintenanceResolver,
  AppSettingsResolver,
  FirewallResolver,
  ScriptResolver,
  PluginPackageResolver,
  GoldenImageResolver,
  PoolResolver
]

export default resolvers as NonEmptyArray<Function>
