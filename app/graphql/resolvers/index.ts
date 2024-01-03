import { NonEmptyArray } from 'type-graphql';
import { UserResolver } from './user/resolver'
import { MachineTemplateResolver } from './machine_template/resolver'
import { MachineResolver } from './machine/resolver'

const resolvers: NonEmptyArray<Function> = [
  UserResolver,
  MachineTemplateResolver,
  MachineResolver,
];

export default resolvers as NonEmptyArray<Function>;
