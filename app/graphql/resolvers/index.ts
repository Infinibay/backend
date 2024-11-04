import { NonEmptyArray } from 'type-graphql';
import { UserResolver } from './user/resolver';
import { MachineTemplateResolver } from './machine_template/resolver';
import { MachineMutations, MachineQueries } from './machine/resolver';
import { SetupResolver } from '@resolvers/setup/resolver';
import { DepartmentResolver } from '@resolvers/department/resolver';
import { MachineTemplateCategoryResolver } from './machine_template_category/resolver';
import { ApplicationQueries, ApplicationMutations } from './application/resolver';

const resolvers: NonEmptyArray<Function> = [
  UserResolver,
  MachineTemplateResolver,
  MachineMutations,
  MachineQueries,
  SetupResolver,
  DepartmentResolver,
  MachineTemplateCategoryResolver,
  ApplicationQueries,
  ApplicationMutations
];

export default resolvers as NonEmptyArray<Function>;
