export function CurrentUser(parent: any, args: any, context: any, info: any) {
  const user = context.user;
  if (!user) {
    return {
      error: 'Not authenticated'
    }
  }
  console.log('====== user ======', user);
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
  };
}