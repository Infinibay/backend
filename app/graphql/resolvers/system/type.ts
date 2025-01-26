import { Field, ObjectType } from 'type-graphql';

@ObjectType()
export class GPU {
  @Field(() => String)
  pciBus: string = '';

  @Field(() => String)
  vendor: string = '';

  @Field(() => String)
  model: string = '';

  @Field(() => Number)
  memory: number = 0;
}
