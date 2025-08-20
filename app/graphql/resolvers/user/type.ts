import {
  ObjectType,
  Field,
  Int,
  ID,
  registerEnumType,
  InputType
} from 'type-graphql'
import { PaginationInputType, OrderByDirection } from '@utils/pagination'

@ObjectType({ description: 'User model' })
export class UserType {
  @Field(type => ID, { nullable: false })
    id: string = ''

  // Add the rest of the fields, like firstName, lastName, role, etc
  @Field({ nullable: false })
    firstName: string = ''

  @Field({ nullable: false })
    lastName: string = ''

  @Field({ nullable: false })
    role: string = ''

  @Field({ nullable: false })
    email: string = ''

  @Field({ nullable: false })
    createdAt: Date = new Date()

  @Field({ nullable: true, description: 'User namespace for real-time events' })
    namespace?: string
}

@ObjectType({ description: 'Token used to log in' })
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
  description: 'The field to order users by'
})

// UserOrderBy
@InputType()
export class UserOrderByInputType {
  @Field(() => UserOrderByField, { nullable: true })
    fieldName: UserOrderByField | undefined

  @Field(() => OrderByDirection, { nullable: true })
    direction: OrderByDirection | undefined
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user'
}

registerEnumType(UserRole, {
  name: 'UserRole', // this one is mandatory
  description: 'The basic roles of users' // this one is optional
})

@InputType()
export class CreateUserInputType {
  @Field(() => String)
    firstName: string = ''

  @Field(() => String)
    lastName: string = ''

  @Field(() => String)
    email: string = ''

  @Field(() => String)
    password: string = ''

  @Field(() => String)
    passwordConfirmation: string = ''

  @Field(() => UserRole)
    role: UserRole = UserRole.USER
}

@InputType()
export class UpdateUserInputType {
  @Field(() => String, { nullable: true })
    firstName: string | undefined = ''

  @Field(() => String, { nullable: true })
    lastName: string | undefined = ''

  @Field(() => String, { nullable: true })
    password: string | undefined = ''

  @Field(() => String, { nullable: true })
    passwordConfirmation: string | undefined = ''

  @Field(() => UserRole, { nullable: true })
    role: UserRole | undefined = UserRole.USER
}
