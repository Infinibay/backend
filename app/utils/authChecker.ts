import { AuthChecker } from 'type-graphql'
import jwt from 'jsonwebtoken'

export const authChecker: AuthChecker<any> = (
    { root, args, context, info },
    level: any // ADMIN, USER
  ) => {
    const token = context.req.headers.authorization;
    if (level == 'ADMIN') {
        if (token) {
            try {
                const decoded: any = jwt.verify(token, process.env.TOKENKEY ?? 'secret')
                console.log(decoded)
                if (decoded.userId && decoded.userRole == 'ADMIN') {
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
                const decoded: any = jwt.verify(token, process.env.TOKENKEY ?? 'secret')
                console.log(decoded)
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
