import jwt from 'jsonwebtoken';

import { APP_SECRET, JWT_ISSUER } from './globals'

export function generateToken(body: any, {expirationHrs='4h'}) {
  if (body.iat == undefined) {
    // Backdate a jwt 30 seconds
    body.iat = Math.floor(Date.now() / 1000) - 30;
  }
  return jwt.sign(body, APP_SECRET, { 
    // algorithm: 'RS256',
    issuer: JWT_ISSUER,
    // Expries in 4 hrs by default
    expiresIn: expirationHrs,
  });
}

export function verifyToken(token: string) {
  // NOTE Does this works?????????
  try {
    console.log('Verify token', token)
  return jwt.verify(token, APP_SECRET, { 
    // algorithms: ['RS256'],
    issuer: JWT_ISSUER 
  });
  } catch (err) {
    console.log('Invalid token: ', err);
    return null;
  }
}