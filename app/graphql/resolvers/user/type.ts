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

  @Field(() => ID, { nullable: true, description: 'Assigned role id (custom or system preset); null falls back to the `role` enum tier' })
    roleId?: string

  @Field({ nullable: false })
    email: string = ''

  @Field({ nullable: true, description: 'User avatar image path' })
    avatar?: string

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

@ObjectType({ description: 'Login response with user data and token' })
export class LoginResponse {
  @Field(() => UserType, { nullable: false })
    user: UserType = new UserType()

  @Field({ nullable: false })
    token: string = ''

  @Field({ nullable: false, description: 'Refresh token used to obtain a new access token' })
    refreshToken: string = ''

  @Field(() => Int, { nullable: false, description: 'Access token lifetime in seconds' })
    expiresIn: number = 0
}

@ObjectType({ description: 'Response from refreshing an access token' })
export class RefreshAuthResponse {
  @Field({ nullable: false })
    token: string = ''

  @Field({ nullable: false, description: 'Rotated refresh token to use for the next refresh' })
    refreshToken: string = ''

  @Field(() => Int, { nullable: false, description: 'Access token lifetime in seconds' })
    expiresIn: number = 0
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
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN'
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

  @Field(() => String, { nullable: true, description: 'User avatar image path' })
    avatar?: string
}

@InputType()
export class UpdateUserInputType {
  @Field(() => String, { nullable: true })
    firstName?: string

  @Field(() => String, { nullable: true })
    lastName?: string

  @Field(() => String, { nullable: true })
    password?: string

  @Field(() => String, { nullable: true })
    passwordConfirmation?: string

  @Field(() => String, { nullable: true, description: 'Current password required when updating password' })
    currentPassword?: string

  @Field(() => UserRole, { nullable: true })
    role?: UserRole

  @Field(() => String, { nullable: true, description: 'User avatar image path' })
    avatar?: string
}
