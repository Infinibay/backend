import { NonEmptyArray } from 'type-graphql';
import { UserResolver } from './user/resolver'
import { MachineTemplateResolver } from './machine_template/resolver'

const resolvers: NonEmptyArray<Function> = [
  UserResolver
];

export default resolvers as NonEmptyArray<Function>;
