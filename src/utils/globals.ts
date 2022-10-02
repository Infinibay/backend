const APP_SECRET = process.env.APP_SECRET || 'appsecret321';
const PASSWORD_PASSES = process.env.PASSWORD_PASSES || 10;
const JWT_ISSUER = process.env.JWT_ISSUER || 'Infinibay';

export { APP_SECRET, PASSWORD_PASSES, JWT_ISSUER };