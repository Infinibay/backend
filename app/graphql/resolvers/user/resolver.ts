import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
    Arg,
    Authorized,
    FieldResolver,
    InputType,
    Int,
    Mutation,
    Query,
    Resolver,
    Root,
    registerEnumType,
    Field,
  } from "type-graphql"
import { UserInputError, AuthenticationError } from 'apollo-server-errors'
import { User, UserToken, UserOrderByInputType } from './type'
import { PaginationInputType } from '@utils/pagination'

interface UserResolverInterface {
    user(id: string): Promise<User | undefined>;
    login(email: string, password: string): Promise<UserToken>;
    createUser(
        email: string,
        password: string,
        passwordConfirmation: string,
        firstName: string,
        lastName: string,
        role: 'USER' | 'ADMIN'
    ): Promise<User>
}

@Resolver(_of => User)
export class UserResolver implements UserResolverInterface {
    /*
    user Query
    @Args:
      id: ID
    Require auth('ADMIN')
    */
    @Query(_returns => User)
    @Authorized('ADMIN')
    async user(
        @Arg('id') id: string
    ): Promise<User | undefined> {
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
    @Query(() => [User])
    @Authorized('ADMIN')
    async users(
        @Arg('orderBy', { nullable: true }) orderBy: UserOrderByInputType,
        @Arg('pagination', { nullable: true }) pagination: PaginationInputType
    ): Promise<User[]> {
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
    @Mutation(() => User)
    @Authorized('ADMIN')
    async createUser(
        @Arg('email') email: string,
        @Arg('password') password: string,
        @Arg('passwordConfirmation') passwordConfirmation: string,
        @Arg('firstName') firstName: string,
        @Arg('lastName') lastName: string,
        @Arg('role') role: 'USER' | 'ADMIN'
    ): Promise<User> {
        const prisma = new PrismaClient()
    
        // Check if password and password confirmation match
        if (password !== passwordConfirmation) {
            throw new UserInputError('Password and password confirmation do not match')
        }

        // Check if the user email already does not exist in db
        const userExists = await prisma.user.findUnique({ where: { email }})
        if (userExists) {
            throw new UserInputError('User already exists')
        }
    
        // Encrypt the password with bcrypt
        const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '10'))
    
        // Create the user with the hashed password
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName,
                lastName,
                role,
                deleted: false,
            }
        })
    
        return Promise.resolve(user)
    }
}

