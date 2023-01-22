import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();

import {isAuth} from "../../middleWare";
import { GraphQLError } from "graphql";

const forUsersList = {
  Query: {
    //////for get  All User List/////
    getUserList: async (parent, input) => {
      try {
        let Search = input["input"]["Search"];
        const foradmin = isAuth();
       // const skip = input["input"]["skip"];
        
        if (foradmin) {
          const page = input["input"]["page"];
          const forGetUserList = await prisma.user.findMany({
            where: {
              Deleted: false,
              userType: "user",
            },
            orderBy: {
              firstName: 'asc',
            },
           take: 2 ,
          // limit : 1,
          // first : 1,
    skip :(page-1)*2,
      // (3-1)*2
// cursor : "1"
          
          }
          );
          
         console.log(forGetUserList);
          if (Search && foradmin) {
            const searchToFind = await prisma.user.findMany({
              where: {
                Deleted: false,
                userType: "user",
                firstName: {
                  contains: Search,
                  mode: "insensitive",
                },
              },
            });
            return searchToFind;
          }
          console.log(forGetUserList);
          return forGetUserList;
        }
      } catch (error) {
        console.log(error);
        // return error;
        throw new GraphQLError("Something went wrong please check again", {
          extensions: {
            StatusCode: 500,
          },
        });
      }
    },
  },
};
export default forUsersList;
