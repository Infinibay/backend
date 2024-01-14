import { AuthChecker } from 'type-graphql'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { Debugger } from './debug'

const debug = new Debugger('authChecker');

export const authChecker: AuthChecker<any> = async (
    { root, args, context, info },
    level: any // ADMIN, USER
  ) => {
    const token = context.req.headers.authorization;
    const prisma = new PrismaClient()
    let decoded: any
    if (token){
        debug.log('Token found, verifying...');
        decoded = jwt.verify(token, process.env.TOKENKEY ?? 'secret')
        if (decoded && decoded.userId) {
            debug.log('Token verified, fetching user...');
            const user = await prisma.user.findUnique({
                where: {
                    id: decoded.userId
                }
            })
            context.user = user
            debug.log('User fetched successfully.');
        }
    } else {
        debug.log('No token found.');
    }

    if (level == 'ADMIN') {
        if (token) {
            try {
                if (decoded && decoded.userRole == 'ADMIN') {
                    debug.log('Access granted for ADMIN.');
                    return true
                } else {
                    debug.log('Access denied for ADMIN.');
                    return false
                }
            } catch(error: any) {
                debug.log('error', `Error checking ADMIN access: ${error}`);
                return false
            }
        } else {
            debug.log('No token found, access denied for ADMIN.');
            return false
        }
    } else if (level == 'USER') {
        if (token) {
            try {
                if (decoded.userId) {
                    debug.log('Access granted for USER.');
                    return true
                } else {
                    debug.log('Access denied for USER.');
                    return false
                }
            } catch(error: any) {
                debug.log('error', `Error checking USER access: ${error}`);
                return false
            }
        }
    }

    debug.log('Access granted by default.');
    return true; // or 'false' if access is denied
  };
