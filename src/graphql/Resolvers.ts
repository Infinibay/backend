import { LogIn } from './queries/LogIn'
import { CreateVm } from './mutations/CreateVm'
import { CurrentUser } from './queries/CurrentUser'

export const resolvers =  {
  Query: {
    logIn: LogIn,
    currentUser: CurrentUser
  },
  Mutation: {
    createVm: CreateVm
  }
}