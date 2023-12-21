import jwt from 'jsonwebtoken'
import { BaseQuery } from "./baseQuery";
import { PrismaClient } from '@prisma/client'

enum AuthLevel {
    None = 0,
    LogedIn,
    Admin   
}

class AuthQuery extends BaseQuery {
    level: AuthLevel = AuthLevel.Admin;
    token: any = ''
    decoded: any = {}

    constructor(level: AuthLevel=AuthLevel.Admin) {
        super();
        this.level = level;
    }

    public before(root: any, input: any, context: any, info: any): Promise<any> {
        this.token = context.req.headers.authorization;
        if (this.level == AuthLevel.LogedIn) {
            if (this.token) {
                try {
                    this.decoded = jwt.verify(this.token, process.env.TOKENKEY ?? 'secret')
                    if (this.decoded.userId) {
                        return Promise.resolve(true);
                    } else {
                        throw new Error('You must be logged in to perform this action');
                    }
                } catch(error: any) {
                    throw new Error('You must be logged in to perform this action');
                }
            } else {
                throw new Error('You must be logged in to perform this action');
            }
        } else if (this.level == AuthLevel.Admin) {
            if (this.token) {
                try {
                    this.decoded = jwt.verify(this.token, process.env.TOKENKEY ?? 'secret')
                    if (this.decoded.userType == 'admin') {
                        return Promise.resolve(true);
                    } else {
                        throw new Error('You must be logged in to perform this action');
                    }
                } catch(error: any) {
                    throw new Error('You must be logged in to perform this action');
                }
            }
        }
        return Promise.resolve(true)
    }
}
