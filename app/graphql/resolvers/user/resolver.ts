import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
    Arg,
    Authorized,
    Mutation,
    Query,
    Resolver,
  } from "type-graphql"
import { UserInputError, AuthenticationError } from 'apollo-server-errors'
import { UserType, UserToken, UserOrderByInputType, CreateUserInputType, UpdateUserInputType } from './type'
import { PaginationInputType } from '@utils/pagination'

export interface UserResolverInterface {
    user(id: string): Promise<UserType | undefined>;
    users(
        orderBy: UserOrderByInputType,
        pagination: PaginationInputType
    ): Promise<UserType[]>;
    login(email: string, password: string): Promise<UserToken>;
    createUser(
        input: CreateUserInputType
    ): Promise<UserType>
    updateUser(
        id: string,
        input: UpdateUserInputType
    ): Promise<UserType>
}

@Resolver(_of => UserType)
export class UserResolver implements UserResolverInterface {
    /*
    user Query
    @Args:
      id: ID
    Require auth('ADMIN')
    */
    @Query(_returns => UserType)
    @Authorized('ADMIN')
    async user(
        @Arg('id') id: string
    ): Promise<UserType | undefined> {
        const prisma = new PrismaClient()
        const user = await prisma.user.findUnique({ where: { id }})
        // thrwo exception if user not found
        if (!user) {
            throw new UserInputError('User not found')
        }
        return user
    }

    /*
    users query
    @Args:
        orderBy: OrderByInputType
        pagination: PaginationInputType
    Require auth('ADMIN')
    */
    @Query(() => [UserType])
    @Authorized('ADMIN')
    async users(
        @Arg('orderBy', { nullable: true }) orderBy: UserOrderByInputType,
        @Arg('pagination', { nullable: true }) pagination: PaginationInputType
    ): Promise<UserType[]> {
        const prisma = new PrismaClient()
        // Check if pagination is valid
        if (pagination.take < 0 || pagination.skip < 0) {
            throw new UserInputError('Invalid pagination')
        }
        const take = pagination.take || 20
        const skip = pagination.skip || 0
        let order: any = {}
        if (orderBy && orderBy.fieldName && orderBy.direction) {
            order = {
                [orderBy.fieldName]: orderBy.direction
            }
        }
        const users = await prisma.user.findMany({
            orderBy: order,
            take: take,
            skip: skip,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true,
            }
        })
        return users || []
    }

    // Login query, requires email and password, returns { token: string }
    @Query(() => UserToken)
    async login(
        @Arg('email') email: string,
        @Arg('password') password: string
    ): Promise<UserToken> {
        const prisma = new PrismaClient()
        const user = await prisma.user.findUnique({ where: { email }})
        if (!user) {
            throw new UserInputError('User not found')
        }
        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) {
            throw new AuthenticationError('Invalid password')
        }
        // Now that we know the user is valid, we can generate a token
        const token = jwt.sign({ userId: user.id, userRole: user.role }, process.env.JWT_SECRET ?? 'secret')
        return Promise.resolve({ token })
    }

    /*
    creatUserMutation
    @Args:
        email: string
        password: string
        passwordConfirmation: string
        firstName: string
        lastName: string
        role: 'USER' | 'ADMIN'
    Require auth('ADMIN)
    */
    @Mutation(() => UserType)
    @Authorized('ADMIN')
    async createUser(
        @Arg('input', { nullable: false }) input: CreateUserInputType
    ): Promise<UserType> {
        const prisma = new PrismaClient()
    
        // Check if password and password confirmation match
        if (input.password !== input.passwordConfirmation) {
            throw new UserInputError('Password and password confirmation do not match')
        }

        // Check if the user email already does not exist in db
        const userExists = await prisma.user.findUnique({ where: { email: input.email }})
        if (userExists) {
            throw new UserInputError('User already exists')
        }
    
        // Encrypt the password with bcrypt
        const hashedPassword = await bcrypt.hash(input.password, parseInt(process.env.BCRYPT_ROUNDS || '10'))
    
        // Create the user with the hashed password
        const user = await prisma.user.create({
            data: {
                email: input.email,
                password: hashedPassword,
                firstName: input.firstName,
                lastName: input.lastName,
                role: input.role,
                deleted: false,
            }
        })
    
        return Promise.resolve(user)
    }

    /*
    udpateUser Mutation
    @Args
        id: ID!
        email: String
        password: String
        passwordConfirmation: String
        firstName: String
        lastName: String
        role: 'USER' | 'ADMIN'
    Require auth('ADMIN')
    */
    @Mutation(() => UserType)
    @Authorized('ADMIN')
    async updateUser(
        @Arg('id') id: string,
        @Arg('input', { nullable: false }) input: UpdateUserInputType
    ): Promise<UserType> {
        const prisma = new PrismaClient()
        const user = await prisma.user.findUnique({ where: { id }})
        if (!user) {
            throw new UserInputError('User not found')
        }
        if (input.password && input.passwordConfirmation) {
            if (input.password !== input.passwordConfirmation) {
                throw new UserInputError('Password and password confirmation do not match')
            }
        }
        const hashedPassword = input.password ? await bcrypt.hash(input.password, parseInt(process.env.BCRYPT_ROUNDS || '10')) : undefined
        const updatedUser = await prisma.user.update({
            where: { id },
            data: {
                password: hashedPassword || user.password,
                firstName: input.firstName || user.firstName,
                lastName: input.lastName || user.lastName,
                role: input.role || user.role
            }
        })
        return updatedUser
    }
}
