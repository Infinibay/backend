import {
    ObjectType,
    Field,
    Int,
    ID,
    registerEnumType,
    InputType
} from 'type-graphql';
import { PaginationInputType, OrderByDirection } from '@utils/pagination'

@ObjectType({ description: 'User model' })
export class User {
    @Field(type => ID, { nullable: false})  
    id: string = ''
    // Add the rest of the fields, like firstName, lastName, role, etc
    @Field({ nullable: false })
    firstName: string = ''

    @Field({ nullable: false })
    lastName: string = ''

    @Field({ nullable: false })
    role: string = ''

    @Field({ nullable: false })
    createdAt: Date = new Date()
}

@ObjectType({ description: 'Token used to log in'})
export class UserToken {
    @Field({ nullable: false })
    token: string = ''
}

// UserOrderByField enum
export enum UserOrderByField {
    ID = 'id',
    EMAIL = 'email',
    FIRST_NAME = 'firstName',
    LAST_NAME = 'lastName',
    ROLE = 'role',
    CREATED_AT = 'createdAt',
    UPDATED_AT = 'updatedAt'
}
registerEnumType(UserOrderByField, {
    name: 'UserOrderByField',
    description: 'The field to order users by',
})

// UserOrderBy
@InputType()
export class UserOrderByInputType {
    @Field(() => UserOrderByField, { nullable: true })
    fieldName: UserOrderByField | undefined

    @Field(() => OrderByDirection, { nullable: true })
    direction: OrderByDirection | undefined
}