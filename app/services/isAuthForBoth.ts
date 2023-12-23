// import jwt from 'jsonwebtoken';
// import { GraphQLError } from 'graphql';
// import logger from '@main/logger'


// const AuthForBoth = (token: any): any => {
//   if (!token) {
//     throw new GraphQLError('A token is required for authentication');
//   }
//   try {
//     const decoded = jwt.verify(token, process.env.TOKENKEY ?? 'secret');
//     if (decoded) {
//       return decoded;
//     } else {
//       throw new GraphQLError('Sorry Access Denied');
//     }
//   } catch (err: any) {
//     logger.error(err, err.message);
//     throw new GraphQLError('Invalid Token');
//   }
// }

// export default AuthForBoth
