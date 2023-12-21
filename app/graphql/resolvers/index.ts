// import { IResolvers } from 'graphql-tools';
import forexport from './virtualMachine.resolver';
import foruserResolverExport from './users.resolver';
import forISOexport from './ISO.resolver';
import forNotificationExports from './notification.resolver';
import diskExport from './disk.resolver';
import forStorageExports from './storage.resolver';

const resolvers: any[] = [
  forexport,
  foruserResolverExport,
  forISOexport,
  forNotificationExports,
  diskExport,
  forStorageExports
];

export default resolvers;
