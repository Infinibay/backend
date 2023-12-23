import { InputType, Field, Int, registerEnumType} from "type-graphql";

@InputType()
export class PaginationInputType {
  @Field(() => Int, { nullable: true })
  take: number = 20

  @Field(() => Int, { nullable: true })
  skip: number =0
}

export enum OrderByDirection {
    ASC = 'asc',
    DESC = 'desc'
}

registerEnumType(OrderByDirection, {
    name: 'OrderByDirection'
})
