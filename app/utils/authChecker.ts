import { AuthChecker } from 'type-graphql'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

export const authChecker: AuthChecker<any> = async (
    { root, args, context, info },
    level: any // ADMIN, USER
  ) => {
    const token = context.req.headers.authorization;
    const prisma = new PrismaClient()
    let decoded: any
    if (token){
        decoded = jwt.verify(token, process.env.TOKENKEY ?? 'secret')
        if (decoded && decoded.userId) {
            const user = await prisma.user.findUnique({
                where: {
                    id: decoded.userId
                }
            })
            context.user = user
        }
    }

    if (level == 'ADMIN') {
        if (token) {
            try {
                if (decoded && decoded.userRole == 'ADMIN') {
                    return true
                } else {
                    return false
                }
            } catch(error: any) {
                return false
            }
        } else {
            return false
        }
    } else if (level == 'USER') {
        if (token) {
            try {
                if (decoded.userId) {
                    return true
                } else {
                    return false
                }
            } catch(error: any) {
                return false
            }
        }
    }

    return true; // or 'false' if access is denied
  };

