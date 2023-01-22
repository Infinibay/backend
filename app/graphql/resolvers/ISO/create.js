import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import AuthForBoth from "../../middleWare"

const forCreateISO = {
  Mutation: {
    async createISO(_root, input) {
      try {
        let token = input["input"]["token"];
        const forID = AuthForBoth(token).id;
        if (forID) {
          const Name = input["input"]["Name"];
          // console.log(Name.endsWith(".iso"));
          const forName = Name.endsWith(".iso");
          // const forend = forName.toLowerCase();
          let parts = Name.split(".");
          let name = parts.slice(0, -1).join(".");
          const filename = name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
          let ext = "." + parts.slice(-1);
          console.log(name, "nam");
          console.log(ext, "ext");
          console.log(filename, "file");
          const forCon = filename + ext;
          console.log(forCon);

          if (forName == true) {
            const forCreateISO = await prisma.ISO.create({
              data: {
                Name: forCon,
                Type: input["input"]["Type"],
                userId: forID,
                createdAt: input["input"]["createdAt"],
                Size: input["input"]["Size"],
              },
            });
            console.log(forCreateISO);
            return forCreateISO;
          }
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Failed to Create", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
  },
};
export default forCreateISO;
